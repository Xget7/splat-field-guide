package com.margelo.nitro.ondevice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.ModelDownloadListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise

class HybridSpeechInput : HybridSpeechInputSpec() {
  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var generation = 0
  private var listening = false
  private var preparedLocale: String? = null
  private var preparation: SpeechRecognizer? = null
  private var preparing: Promise<SpeechInputAvailability>? = null
  private var preparationGeneration = 0

  override fun requestPermission(): Promise<SpeechPermission> {
    val promise = Promise<SpeechPermission>()
    main.post {
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(SpeechPermission.GRANTED)
      } else {
        val activity = context.currentActivity as? PermissionAwareActivity
        if (activity == null) promise.resolve(SpeechPermission.RESTRICTED)
        else activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_REQUEST,
          PermissionListener { code, _, results ->
            if (code != PERMISSION_REQUEST) false
            else {
              promise.resolve(if (results.firstOrNull() == PackageManager.PERMISSION_GRANTED)
                SpeechPermission.GRANTED else SpeechPermission.DENIED)
              true
            }
          })
      }
    }
    return promise
  }

  override fun prepare(locale: String): Promise<SpeechInputAvailability> {
    val promise = Promise<SpeechInputAvailability>()
    main.post {
      preparation?.destroy()
      preparing?.resolve(SpeechInputAvailability.UNAVAILABLE)
      preparedLocale = null
      preparation = null
      preparing = promise
      val token = ++preparationGeneration
      fun finish(available: Boolean) {
        if (token != preparationGeneration || preparing !== promise) return
        preparation?.destroy()
        preparation = null
        preparing = null
        preparedLocale = if (available) locale else null
        promise.resolve(if (available) SpeechInputAvailability.AVAILABLE else SpeechInputAvailability.UNAVAILABLE)
      }
      if (!onDeviceAvailable()) {
        finish(SpeechRecognizer.isRecognitionAvailable(context))
        return@post
      }
      if (Build.VERSION.SDK_INT < 33) { finish(true); return@post }
      try {
        val speech = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        preparation = speech
        val intent = recognitionIntent(locale)
        fun containsLanguage(languages: List<String>) = languages.any {
          it.replace('_', '-').equals(locale, ignoreCase = true)
        }
        speech.checkRecognitionSupport(intent, context.mainExecutor, object : RecognitionSupportCallback {
          override fun onError(error: Int) { finish(false) }
          override fun onSupportResult(support: RecognitionSupport) {
            if (token != preparationGeneration) return
            if (containsLanguage(support.installedOnDeviceLanguages)) finish(true)
            else if (Build.VERSION.SDK_INT >= 34 && containsLanguage(support.supportedOnDeviceLanguages)) {
              try {
                speech.triggerModelDownload(intent, context.mainExecutor, object : ModelDownloadListener {
                  override fun onProgress(progress: Int) {}
                  override fun onSuccess() { finish(true) }
                  override fun onScheduled() { finish(false) }
                  override fun onError(error: Int) { finish(false) }
                })
              } catch (error: Exception) { finish(false) }
            } else finish(false)
          }
        })
      } catch (error: Exception) { finish(false) }
    }
    return promise
  }

  private fun onDeviceAvailable() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  private fun recognitionIntent(locale: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
  }

  override fun listen(locale: String, hints: Array<String>, onPartial: (String) -> Unit,
    onTurn: (String) -> Unit, onLevel: (Double) -> Unit, onVoice: (Boolean) -> Unit,
    onStopped: (String) -> Unit): Promise<Unit> {
    val promise = Promise<Unit>()
    main.post {
      if (listening || preparedLocale != locale ||
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject(IllegalStateException(INPUT_NOT_READY))
        return@post
      }
      if (!OnDeviceAudioOwnership.acquire(this)) {
        promise.reject(IllegalStateException(INPUT_NOT_READY))
        return@post
      }
      val token = ++generation
      var level = 0.0
      var lastLevel = 0L
      try {
        val speech = if (Build.VERSION.SDK_INT >= 31 && onDeviceAvailable()) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
          else SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = speech
        listening = true
        val intent = recognitionIntent(locale).apply {
          if (Build.VERSION.SDK_INT >= 33) putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(hints.toList()))
        }
        fun current() = listening && generation == token
        fun stopped(reason: String) {
          if (!current()) return
          listening = false
          OnDeviceAudioOwnership.release(this@HybridSpeechInput)
          recognizer = null
          speech.destroy()
          onVoice(false)
          onLevel(0.0)
          onStopped(reason)
        }
        fun restart() {
          if (!current()) return
          main.postDelayed({
            if (current()) try { speech.startListening(intent) }
            catch (error: Exception) { stopped(error.message ?: RESTART_FAILED) }
          }, RESTART_MS)
        }
        speech.setRecognitionListener(object : RecognitionListener {
          override fun onReadyForSpeech(params: Bundle?) {}
          override fun onBeginningOfSpeech() { if (current()) onVoice(true) }
          override fun onEndOfSpeech() { if (current()) { onVoice(false); onLevel(0.0) } }
          override fun onRmsChanged(rmsdB: Float) {
            if (!current()) return
            val now = System.nanoTime()
            if (now - lastLevel < LEVEL_INTERVAL_NS) return
            lastLevel = now
            level += (((rmsdB + 2.0) / 12.0).coerceIn(0.0, 1.0) - level) * 0.25
            onLevel(level)
          }
          override fun onPartialResults(results: Bundle?) {
            if (current()) results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
          }
          override fun onResults(results: Bundle?) {
            if (!current()) return
            onVoice(false)
            onLevel(0.0)
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
            if (text.isNotEmpty()) onTurn(text)
            restart()
          }
          override fun onError(error: Int) {
            if (!current()) return
            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
              onVoice(false); onLevel(0.0); restart()
            }
            else stopped(when (error) {
              SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> MODEL_NOT_INSTALLED.format(locale)
              SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> LANGUAGE_UNAVAILABLE.format(locale)
              SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> NETWORK_REQUIRED
              SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> PERMISSION_LOST
              SpeechRecognizer.ERROR_AUDIO -> AUDIO_INTERRUPTED
              else -> RECOGNITION_STOPPED.format(error)
            })
          }
          override fun onBufferReceived(buffer: ByteArray?) {}
          override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        speech.startListening(intent)
        promise.resolve(Unit)
      } catch (error: Exception) {
        listening = false
        OnDeviceAudioOwnership.release(this)
        recognizer?.destroy()
        recognizer = null
        promise.reject(error)
      }
    }
    return promise
  }

  override fun cancel() {
    main.post {
      generation++
      listening = false
      OnDeviceAudioOwnership.release(this)
      recognizer?.cancel()
      recognizer?.destroy()
      recognizer = null
    }
  }

  override fun dispose() {
    cancel()
    main.post {
      preparationGeneration++
      preparation?.destroy()
      preparation = null
      preparing?.resolve(SpeechInputAvailability.UNAVAILABLE)
      preparing = null
    }
    super.dispose()
  }
  companion object {
    private const val PERMISSION_REQUEST = 8711
    private const val RESTART_MS = 150L
    private const val LEVEL_INTERVAL_NS = 33_333_333L
    private const val INPUT_NOT_READY = "Speech input is not prepared, permitted, or already listening"
    private const val RESTART_FAILED = "Speech recognition could not restart"
    private const val MODEL_NOT_INSTALLED = "The speech model for %s is not installed"
    private const val LANGUAGE_UNAVAILABLE = "Speech input is unavailable for %s"
    private const val NETWORK_REQUIRED = "Speech input needs a network connection"
    private const val PERMISSION_LOST = "Microphone access was lost"
    private const val AUDIO_INTERRUPTED = "Microphone input was interrupted"
    private const val RECOGNITION_STOPPED = "Speech recognition stopped with error %d"
  }
}

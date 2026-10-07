package com.margelo.nitro.ondevice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.ModelDownloadListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise

class HybridSpeechInput : HybridSpeechInputSpec() {
  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var recognizerReadyAt = 0L
  private var disposed = false
  private var generation = 0
  private var listening = false
  private var listeningRequest = 0
  private var preparedLocale: String? = null
  private var preparing: Promise<SpeechInputAvailability>? = null
  private var preparationGeneration = 0

  override fun requestPermission(): Promise<SpeechPermission> = MicrophonePermission.request()

  override fun prepare(locale: String): Promise<SpeechInputAvailability> = prepareLocale(locale, install = false)

  override fun install(locale: String): Promise<SpeechInputAvailability> = prepareLocale(locale, install = true)

  private fun prepareLocale(locale: String, install: Boolean): Promise<SpeechInputAvailability> {
    val promise = Promise<SpeechInputAvailability>()
    main.post {
      if (disposed) {
        promise.resolve(SpeechInputAvailability.UNAVAILABLE)
        return@post
      }
      if (listening) {
        // The active locale is already ready; querying or downloading must not disturb its session.
        promise.resolve(if (preparedLocale == locale) SpeechInputAvailability.AVAILABLE else SpeechInputAvailability.UNAVAILABLE)
        return@post
      }
      preparing?.resolve(SpeechInputAvailability.UNAVAILABLE)
      preparedLocale = null
      preparing = promise
      val token = ++preparationGeneration
      fun finish(available: Boolean) {
        if (token != preparationGeneration || preparing !== promise) return
        preparing = null
        preparedLocale = if (available) locale else null
        promise.resolve(if (available) SpeechInputAvailability.AVAILABLE else SpeechInputAvailability.UNAVAILABLE)
      }
      if (!onDeviceAvailable()) {
        finish(SpeechRecognizer.isRecognitionAvailable(context))
        return@post
      }
      if (Build.VERSION.SDK_INT < 33) { finish(true); return@post }
      whenRecognizerReady {
        if (token != preparationGeneration || preparing !== promise) return@whenRecognizerReady
        try {
          val speech = speechRecognizer()
          fun currentPreparation() = token == preparationGeneration && preparing === promise && recognizer === speech
          fun failed(error: Int) {
            if (!currentPreparation()) return
            finish(false)
            if (recoverableServiceError(error) || error == SpeechRecognizer.ERROR_SERVER) dropRecognizer()
          }
          // Connection failures can arrive here instead of on the support/download callback.
          speech.setRecognitionListener(object : SpeechListener() {
            override fun onError(error: Int) {
              if (currentPreparation()) failed(error)
              else if (!listening && recognizer === speech && recoverableServiceError(error)) dropRecognizer()
            }
          })
          val intent = recognitionIntent(locale)
          fun containsLanguage(languages: List<String>) = languages.any {
            it.replace('_', '-').equals(locale, ignoreCase = true)
          }
          speech.checkRecognitionSupport(intent, context.mainExecutor, object : RecognitionSupportCallback {
            override fun onError(error: Int) { failed(error) }
            override fun onSupportResult(support: RecognitionSupport) {
              if (!currentPreparation()) return
              if (containsLanguage(support.installedOnDeviceLanguages)) finish(true)
              else if (install && Build.VERSION.SDK_INT >= 34 && containsLanguage(support.supportedOnDeviceLanguages)) {
                try {
                  speech.triggerModelDownload(intent, context.mainExecutor, object : ModelDownloadListener {
                    override fun onProgress(progress: Int) {}
                    override fun onSuccess() { finish(true) }
                    override fun onScheduled() { finish(false) }
                    override fun onError(error: Int) { failed(error) }
                  })
                } catch (error: Exception) { finish(false) }
              } else finish(false)
            }
          })
        } catch (error: Exception) { finish(false) }
      }
    }
    return promise
  }

  private fun onDeviceAvailable() = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  // Preparation and listening must share a recognizer so preparation cannot tear down the service.
  private fun speechRecognizer(): SpeechRecognizer = recognizer ?: (
    if (onDeviceAvailable()) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    else SpeechRecognizer.createSpeechRecognizer(context)
  ).also { recognizer = it }

  private fun dropRecognizer() {
    val speech = recognizer
    recognizer = null
    if (speech != null) {
      preparationGeneration++
      preparing?.resolve(SpeechInputAvailability.UNAVAILABLE)
      preparing = null
      // Every replacement path waits, including preparation after a cancelled retry.
      recognizerReadyAt = SystemClock.uptimeMillis() + RESTART_MS
      speech.destroy()
    }
  }

  private fun whenRecognizerReady(action: () -> Unit) {
    val delay = (recognizerReadyAt - SystemClock.uptimeMillis()).coerceAtLeast(0L)
    if (delay == 0L) action()
    else main.postDelayed({ whenRecognizerReady(action) }, delay)
  }

  private fun recoverableServiceError(error: Int) = error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED ||
    error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY

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
      val request = ++listeningRequest
      whenRecognizerReady {
        OnDeviceAudioOwnership.whenReady ready@ {
          if (disposed || request != listeningRequest) {
            promise.reject(IllegalStateException(INPUT_CANCELLED))
            return@ready
          }
          if (listening || OnDeviceAudioOwnership.occupied) {
            promise.reject(IllegalStateException(OnDeviceAudioOwnership.ALREADY_LISTENING))
            return@ready
          }
          if (preparedLocale != locale ||
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            promise.reject(IllegalStateException(INPUT_NOT_READY))
            return@ready
          }
          if (!OnDeviceAudioOwnership.acquire(this)) {
            promise.reject(IllegalStateException(OnDeviceAudioOwnership.ALREADY_LISTENING))
            return@ready
          }
          val token = ++generation
          val meter = AudioLevel(RECOGNITION_FLOOR_DB, RECOGNITION_CEILING_DB)
          try {
            listening = true
            var receivedResult = false
            var serviceRetries = 0
            val intent = recognitionIntent(locale).apply {
              if (Build.VERSION.SDK_INT >= 33) putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(hints.toList()))
            }
            fun current() = listening && generation == token
            fun stopped(reason: String, discardRecognizer: Boolean = false) {
              if (!current()) return
              listening = false
              if (discardRecognizer) dropRecognizer() else recognizer?.cancel()
              OnDeviceAudioOwnership.release(this@HybridSpeechInput)
              onVoice(false)
              onLevel(0.0)
              onStopped(reason)
            }
            fun start(speech: SpeechRecognizer) {
              fun active() = current() && recognizer === speech
              fun restart() {
                if (!active()) return
                main.postDelayed({
                  if (active()) try { speech.startListening(intent) }
                  catch (error: Exception) { stopped(error.message ?: RESTART_FAILED, discardRecognizer = true) }
                }, RESTART_MS)
              }
              speech.setRecognitionListener(object : SpeechListener() {
                override fun onBeginningOfSpeech() { if (active()) onVoice(true) }
                override fun onEndOfSpeech() { if (active()) { onVoice(false); onLevel(0.0) } }
                override fun onRmsChanged(rmsdB: Float) {
                  if (!active()) return
                  meter.update(rmsdB.toDouble())?.let(onLevel)
                }
                override fun onPartialResults(results: Bundle?) {
                  if (!active()) return
                  receivedResult = true
                  results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
                }
                override fun onResults(results: Bundle?) {
                  if (!active()) return
                  receivedResult = true
                  onVoice(false)
                  onLevel(0.0)
                  val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                  if (text.isNotEmpty()) onTurn(text)
                  restart()
                }
                override fun onError(error: Int) {
                  if (!active()) {
                    if (!listening && recognizer === speech && recoverableServiceError(error)) dropRecognizer()
                    return
                  }
                  if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    onVoice(false); onLevel(0.0); restart()
                  }
                  else if (!receivedResult && serviceRetries < SERVICE_RETRY_LIMIT && recoverableServiceError(error)) {
                    serviceRetries++
                    dropRecognizer()
                    onVoice(false)
                    onLevel(0.0)
                    whenRecognizerReady {
                      if (current()) try { start(speechRecognizer()) }
                      catch (error: Exception) { stopped(error.message ?: RESTART_FAILED, discardRecognizer = true) }
                    }
                  } else stopped(when (error) {
                    SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> MODEL_NOT_INSTALLED.format(locale)
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> LANGUAGE_UNAVAILABLE.format(locale)
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> NETWORK_REQUIRED
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> PERMISSION_LOST
                    SpeechRecognizer.ERROR_AUDIO -> AUDIO_INTERRUPTED
                    else -> RECOGNITION_STOPPED.format(error)
                  }, discardRecognizer = recoverableServiceError(error) || error == SpeechRecognizer.ERROR_SERVER)
                }
              })
              speech.startListening(intent)
            }
            start(speechRecognizer())
            promise.resolve(Unit)
          } catch (error: Exception) {
            listening = false
            dropRecognizer()
            OnDeviceAudioOwnership.release(this)
            promise.reject(error)
          }
        }
      }
    }
    return promise
  }

  private fun cancelRecognition() {
    generation++
    listeningRequest++
    listening = false
    recognizer?.cancel()
    OnDeviceAudioOwnership.release(this)
  }

  override fun cancel() {
    main.post { cancelRecognition() }
  }

  override fun dispose() {
    main.post {
      disposed = true
      cancelRecognition()
      preparationGeneration++
      preparing?.resolve(SpeechInputAvailability.UNAVAILABLE)
      preparing = null
      preparedLocale = null
      dropRecognizer()
    }
    super.dispose()
  }

  private abstract class SpeechListener : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onEndOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onPartialResults(results: Bundle?) {}
    override fun onResults(results: Bundle?) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  companion object {
    private const val RESTART_MS = 150L
    private const val SERVICE_RETRY_LIMIT = 1
    private const val RECOGNITION_FLOOR_DB = -2.0
    private const val RECOGNITION_CEILING_DB = 10.0
    private const val INPUT_CANCELLED = "Speech input was cancelled"
    private const val INPUT_NOT_READY = "Speech input is not prepared or permitted"
    private const val RESTART_FAILED = "Speech recognition could not restart"
    private const val MODEL_NOT_INSTALLED = "The speech model for %s is not installed"
    private const val LANGUAGE_UNAVAILABLE = "Speech input is unavailable for %s"
    private const val NETWORK_REQUIRED = "Speech input needs a network connection"
    private const val PERMISSION_LOST = "Microphone access was lost"
    private const val AUDIO_INTERRUPTED = "Microphone input was interrupted"
    private const val RECOGNITION_STOPPED = "Speech recognition stopped with error %d"
  }
}

package com.margelo.nitro.ondevice

import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.Locale

class HybridSpeechOutput : HybridSpeechOutputSpec() {
  private val main = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var initialized: Boolean? = null
  private var pending: (() -> Unit)? = null
  private val preparing = mutableListOf<Promise<SpeechVoice>>()
  private var completion: Promise<Unit>? = null
  private var onWord: ((Double, Double) -> Unit)? = null
  private var generation = 0
  private var finalId = ""

  override fun prepare(voice: SpeechVoice): Promise<SpeechVoice> {
    val promise = Promise<SpeechVoice>()
    main.post {
      when (initialized) {
        true -> promise.resolve(SpeechVoice.SYSTEM)
        false -> promise.reject(IllegalStateException(OUTPUT_UNAVAILABLE))
        null -> { preparing.add(promise); initialize() }
      }
    }
    return promise
  }

  private fun initialize() {
    if (tts != null) return
    try {
      tts = TextToSpeech(requireNotNull(NitroModules.applicationContext)) { status ->
        main.post {
          initialized = status == TextToSpeech.SUCCESS
          tts?.setOnUtteranceProgressListener(listener)
          settlePreparation()
          startPending()
        }
      }
    } catch (_: Exception) {
      initialized = false
      settlePreparation()
      startPending()
    }
  }

  private fun startPending() {
    val action = pending
    pending = null
    action?.invoke()
  }

  private fun settlePreparation() {
    val waiters = preparing.toList()
    preparing.clear()
    waiters.forEach {
      if (initialized == true) it.resolve(SpeechVoice.SYSTEM)
      else it.reject(IllegalStateException(OUTPUT_UNAVAILABLE))
    }
  }

  override fun speak(text: String, locale: String, onWord: (Double, Double) -> Unit,
    voice: SpeechVoice): Promise<Unit> {
    val promise = Promise<Unit>()
    main.post {
      stopOnMain()
      val token = ++generation
      completion = promise
      this.onWord = onWord
      val start = {
        if (generation == token) {
          val engine = tts
          if (initialized != true || engine == null) finish(IllegalStateException(OUTPUT_UNAVAILABLE))
          else {
            val language = Locale.forLanguageTag(locale)
            val voice = engine.voices?.filter { !it.isNetworkConnectionRequired &&
              TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features && it.locale.language == language.language }
              ?.maxByOrNull { it.quality }
            if (voice == null) finish(IllegalStateException(VOICE_UNAVAILABLE.format(locale)))
            else {
              engine.voice = voice
              engine.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
              val limit = TextToSpeech.getMaxSpeechInputLength() - 1
              var offset = 0
              while (offset < text.length) {
                var end = minOf(text.length, offset + limit)
                if (end < text.length) {
                  val space = text.lastIndexOf(' ', end)
                  if (space > offset) end = space + 1
                }
                val id = "$token:$offset"
                finalId = id
                if (engine.speak(text.substring(offset, end), TextToSpeech.QUEUE_ADD, null, id) == TextToSpeech.ERROR) {
                  finish(IllegalStateException(OUTPUT_FAILED)); break
                }
                offset = end
              }
              if (text.isEmpty()) finish(null)
            }
          }
        }
      }
      if (initialized == null) { pending = start; initialize() }
      else start()
    }
    return promise
  }

  private val listener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) {}
    override fun onDone(utteranceId: String?) { main.post { if (utteranceId == finalId) finish(null) } }
    @Deprecated("Platform callback")
    override fun onError(utteranceId: String?) { reportError(utteranceId) }
    override fun onError(utteranceId: String?, errorCode: Int) { reportError(utteranceId) }
    override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
      main.post {
        if (utteranceId?.substringBefore(':') == generation.toString()) {
          val offset = utteranceId.substringAfter(':').toInt()
          onWord?.invoke((offset + start).toDouble(), (end - start).toDouble())
        }
      }
    }
  }
  private fun reportError(id: String?) { main.post {
    if (id?.substringBefore(':') == generation.toString()) finish(IllegalStateException(OUTPUT_FAILED))
  } }
  private fun finish(error: Exception?) {
    val promise = completion
    completion = null
    onWord = null
    finalId = ""
    if (error == null) promise?.resolve(Unit) else promise?.reject(error)
  }
  private fun stopOnMain() {
    generation++
    pending = null
    tts?.stop()
    finish(null)
  }
  override fun stop() { main.post { stopOnMain() } }
  override fun dispose() {
    main.post {
      stopOnMain()
      tts?.shutdown()
      tts = null
      initialized = false
      preparing.forEach { it.reject(IllegalStateException(OUTPUT_UNAVAILABLE)) }
      preparing.clear()
    }
    super.dispose()
  }

  companion object {
    private const val OUTPUT_UNAVAILABLE = "System speech output is unavailable"
    private const val VOICE_UNAVAILABLE = "No installed voice for %s"
    private const val OUTPUT_FAILED = "System speech output failed"
  }
}

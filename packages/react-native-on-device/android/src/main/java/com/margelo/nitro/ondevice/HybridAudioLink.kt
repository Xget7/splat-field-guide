package com.margelo.nitro.ondevice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue

class HybridAudioLink : HybridAudioLinkSpec() {
  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var session: Session? = null
  private val cleanup = Executors.newSingleThreadExecutor()
  private var startGeneration = 0
  private var disposed = false

  override fun requestPermission(): Promise<Boolean> {
    val promise = Promise<Boolean>()
    MicrophonePermission.request().then { permission ->
      promise.resolve(permission == SpeechPermission.GRANTED)
    }.catch { error -> promise.reject(error) }
    return promise
  }

  private data class Packet(val bytes: ByteArray, val generation: Long)
  private class Session(val inputRate: Int, val outputRate: Int, val onInput: (String) -> Unit,
    val onLevel: (Double) -> Unit, val onStopped: (String) -> Unit, val manager: AudioManager) {
    @Volatile var active = true
    val outputLock = Any()
    val queue = LinkedBlockingQueue<Packet>()
    var outputGeneration = 0L
    var record: AudioRecord? = null
    var track: AudioTrack? = null
    var echo: AcousticEchoCanceler? = null
    var noise: NoiseSuppressor? = null
    var focus: AudioFocusRequest? = null
    var reader: Thread? = null
    var writer: Thread? = null
    val previousMode = manager.mode
    var changedMode = false
    var lastHead = 0L
    var headWraps = 0L
    var headBase = 0L
  }

  override fun start(inputRate: Double, outputRate: Double, onInput: (String) -> Unit,
    onLevel: (Double) -> Unit, onStopped: (String) -> Unit): Promise<Unit> {
    val promise = Promise<Unit>()
    main.post {
      val token = startGeneration
      OnDeviceAudioOwnership.whenReady {
        if (token != startGeneration) promise.reject(IllegalStateException(START_CANCELLED))
        else startOnMain(inputRate, outputRate, onInput, onLevel, onStopped, promise)
      }
    }
    return promise
  }

  private fun startOnMain(inputRate: Double, outputRate: Double, onInput: (String) -> Unit,
    onLevel: (Double) -> Unit, onStopped: (String) -> Unit, promise: Promise<Unit>) {
    var link: Session? = null
    try {
      check(!disposed) { START_CANCELLED }
      check(session == null) { OnDeviceAudioOwnership.ALREADY_LISTENING }
      check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
        PERMISSION_REQUIRED
      }
      require(validRate(inputRate) && validRate(outputRate) && inputRate.toInt() % CHUNKS_PER_SECOND == 0) {
        INVALID_RATE
      }
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val next = Session(inputRate.toInt(), outputRate.toInt(), onInput, onLevel, onStopped, manager)
      check(OnDeviceAudioOwnership.acquire(this)) { OnDeviceAudioOwnership.ALREADY_LISTENING }
      link = next
      session = next
      configure(next)
      next.reader = Thread({ read(next) }, READER_THREAD).apply { start() }
      next.writer = Thread({ write(next) }, WRITER_THREAD).apply { start() }
      promise.resolve(Unit)
    } catch (error: Exception) {
      link?.let(::close)
      promise.reject(error)
    }
  }

  private fun configure(link: Session) {
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      .setAudioAttributes(attributes).setOnAudioFocusChangeListener({ change ->
        focusChanged(link, change)
      }, main).build()
    link.focus = focus
    check(link.manager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { FOCUS_UNAVAILABLE }
    link.manager.mode = AudioManager.MODE_IN_COMMUNICATION
    link.changedMode = true
    val record = createRecord(link)
    if (AcousticEchoCanceler.isAvailable()) {
      link.echo = AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true }
    }
    if (NoiseSuppressor.isAvailable()) {
      link.noise = NoiseSuppressor.create(record.audioSessionId)?.apply { enabled = true }
    }
    createTrack(link, attributes)
    record.startRecording()
    check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { INPUT_UNAVAILABLE }
    link.lastHead = playbackHead(link)
    link.headBase = link.lastHead
    link.track?.play()
  }

  private fun createRecord(link: Session): AudioRecord {
    val minimum = AudioRecord.getMinBufferSize(link.inputRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    require(minimum > 0) { INVALID_RATE }
    val record = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, link.inputRate,
      AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minimum, bufferBytes(link.inputRate)))
    link.record = record
    check(record.state == AudioRecord.STATE_INITIALIZED) { INPUT_UNAVAILABLE }
    return record
  }

  private fun createTrack(link: Session, attributes: AudioAttributes) {
    val minimum = AudioTrack.getMinBufferSize(link.outputRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    require(minimum > 0) { INVALID_RATE }
    link.track = AudioTrack.Builder().setAudioAttributes(attributes).setAudioFormat(AudioFormat.Builder()
      .setSampleRate(link.outputRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
      .setBufferSizeInBytes(maxOf(minimum, bufferBytes(link.outputRate)))
      .setTransferMode(AudioTrack.MODE_STREAM).build()
    check(link.track?.state == AudioTrack.STATE_INITIALIZED) { OUTPUT_UNAVAILABLE }
  }

  private fun focusChanged(link: Session, change: Int) {
    if (session !== link || !link.active) return
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> lost(link, FOCUS_LOST)
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> setVolume(link, DUCKED_VOLUME)
      AudioManager.AUDIOFOCUS_GAIN -> setVolume(link, NORMAL_VOLUME)
    }
  }

  private fun setVolume(link: Session, volume: Float) {
    synchronized(link.outputLock) { if (link.active) link.track?.setVolume(volume) }
  }

  private fun read(link: Session) {
    val record = requireNotNull(link.record)
    val samples = ShortArray(link.inputRate / CHUNKS_PER_SECOND)
    val meter = AudioLevel()
    var filled = 0
    try {
      while (link.active) {
        val count = record.read(samples, filled, samples.size - filled, AudioRecord.READ_BLOCKING)
        if (!link.active) break
        check(count > 0) { INPUT_LOST }
        filled += count
        if (filled < samples.size) continue
        filled = 0
        deliverInput(link, samples, meter)
      }
    } catch (_: Exception) { main.post { lost(link, INPUT_LOST) } }
  }

  private fun deliverInput(link: Session, samples: ShortArray, meter: AudioLevel) {
    val level = meter.update(samples)
    val chunk = Base64.encodeToString(pcm16Bytes(samples), Base64.NO_WRAP)
    main.post {
      if (session === link && link.active) {
        level?.let(link.onLevel)
        link.onInput(chunk)
      }
    }
  }

  private fun write(link: Session) {
    try {
      while (link.active) {
        val packet = link.queue.take()
        var offset = 0
        while (link.active && offset < packet.bytes.size) {
          val count = synchronized(link.outputLock) {
            if (!link.active || packet.generation != link.outputGeneration) return@synchronized null
            link.track?.write(packet.bytes, offset, packet.bytes.size - offset, AudioTrack.WRITE_NON_BLOCKING)
          } ?: break
          check(count >= 0) { OUTPUT_LOST }
          offset += count
          if (count == 0) Thread.sleep(WRITER_RETRY_MS)
        }
      }
    } catch (_: InterruptedException) {
      if (link.active) main.post { lost(link, OUTPUT_LOST) }
    } catch (_: Exception) { main.post { lost(link, OUTPUT_LOST) } }
  }

  override fun play(chunk: String) {
    val link = session ?: return
    val bytes = Base64.decode(chunk, Base64.DEFAULT)
    require(bytes.size % PCM16_BYTES_PER_SAMPLE == 0) { INVALID_CHUNK }
    if (bytes.isEmpty()) return
    synchronized(link.outputLock) {
      if (link.active) link.queue.add(Packet(bytes, link.outputGeneration))
    }
  }

  override fun clear() {
    val link = session ?: return
    synchronized(link.outputLock) {
      if (!link.active) return
      link.outputGeneration++
      link.queue.clear()
      link.track?.pause()
      link.track?.flush()
      link.lastHead = playbackHead(link)
      link.headWraps = 0
      link.headBase = link.lastHead
      link.track?.play()
    }
  }

  override fun playedMs(): Double {
    val link = session ?: return 0.0
    return synchronized(link.outputLock) {
      if (!link.active) return@synchronized 0.0
      val head = playbackHead(link)
      if (head < link.lastHead) link.headWraps += PLAYBACK_HEAD_RANGE
      link.lastHead = head
      (link.headWraps + head - link.headBase).toDouble() / link.outputRate * MILLISECONDS_PER_SECOND
    }
  }

  private fun lost(link: Session, reason: String) {
    if (session !== link || !link.active) return
    close(link)
    link.onStopped(reason)
  }

  private fun close(link: Session) {
    if (!link.active) return
    if (session === link) session = null
    synchronized(link.outputLock) {
      link.active = false
      link.outputGeneration++
      link.queue.clear()
      runCatching { link.track?.pause(); link.track?.flush() }
    }
    OnDeviceAudioOwnership.beginRelease(this)
    link.reader?.interrupt()
    link.writer?.interrupt()
    cleanup.execute {
      releaseResources(link)
      main.post {
        try {
          if (link.changedMode) link.manager.mode = link.previousMode
        } finally { OnDeviceAudioOwnership.release(this) }
      }
    }
  }

  private fun releaseResources(link: Session) {
    // Stop unblocks a blocking microphone read before its resources are released.
    runCatching { link.record?.stop() }
    runCatching { link.reader?.join(THREAD_JOIN_MS); link.writer?.join(THREAD_JOIN_MS) }
    runCatching { link.echo?.release() }
    runCatching { link.noise?.release() }
    runCatching { link.record?.release() }
    synchronized(link.outputLock) {
      runCatching { link.track?.release() }
      link.track = null
    }
    runCatching { link.focus?.let { link.manager.abandonAudioFocusRequest(it) } }
  }

  private fun stopOnMain() {
    startGeneration++
    session?.let(::close)
  }

  override fun stop() { main.post { stopOnMain() } }
  override fun dispose() {
    main.post { disposed = true; stopOnMain(); cleanup.shutdown() }
    super.dispose()
  }

  companion object {
    private const val DUCKED_VOLUME = 0.2f
    private const val NORMAL_VOLUME = 1.0f
    private const val START_CANCELLED = "Audio link start was cancelled"
    private const val CHUNKS_PER_SECOND = 10
    private const val BUFFER_CHUNKS = 2
    private const val MINIMUM_RATE = 8000.0
    private const val MAXIMUM_RATE = 192000.0
    private const val MILLISECONDS_PER_SECOND = 1000.0
    private const val WRITER_RETRY_MS = 5L
    private const val THREAD_JOIN_MS = 250L
    private const val PLAYBACK_HEAD_MASK = 0xffff_ffffL
    private const val PLAYBACK_HEAD_RANGE = 0x1_0000_0000L
    private const val READER_THREAD = "FieldGuideAudioInput"
    private const val WRITER_THREAD = "FieldGuideAudioOutput"
    private const val INVALID_RATE = "Audio link requires supported whole sample rates and 100 ms input chunks"
    private const val PERMISSION_REQUIRED = "Microphone permission required for audio link"
    private const val INVALID_CHUNK = "Audio link requires base64 little-endian PCM16"
    private const val INPUT_UNAVAILABLE = "Audio link microphone is unavailable"
    private const val OUTPUT_UNAVAILABLE = "Audio link player is unavailable"
    private const val INPUT_LOST = "Audio link microphone stopped"
    private const val OUTPUT_LOST = "Audio link playback stopped"
    private const val FOCUS_UNAVAILABLE = "Audio link could not obtain audio focus"
    private const val FOCUS_LOST = "Audio focus lost"
    private fun playbackHead(link: Session) = (link.track?.playbackHeadPosition ?: 0).toLong() and PLAYBACK_HEAD_MASK
    private fun bufferBytes(rate: Int) = rate / CHUNKS_PER_SECOND * PCM16_BYTES_PER_SAMPLE * BUFFER_CHUNKS
    private fun validRate(rate: Double) = rate.isFinite() && rate >= MINIMUM_RATE && rate <= MAXIMUM_RATE && rate % 1.0 == 0.0
  }
}

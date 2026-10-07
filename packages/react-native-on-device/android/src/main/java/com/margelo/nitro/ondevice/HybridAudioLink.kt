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
import java.util.concurrent.LinkedBlockingQueue
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.sqrt

class HybridAudioLink : HybridAudioLinkSpec() {
  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var session: Session? = null

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
  }

  override fun start(inputRate: Double, outputRate: Double, onInput: (String) -> Unit,
    onLevel: (Double) -> Unit, onStopped: (String) -> Unit): Promise<Unit> {
    val promise = Promise<Unit>()
    main.post {
      if (session != null) { promise.reject(IllegalStateException(ALREADY_LISTENING)); return@post }
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        promise.reject(IllegalStateException(PERMISSION_REQUIRED)); return@post
      }
      if (!validRate(inputRate) || !validRate(outputRate) || inputRate.toInt() % CHUNKS_PER_SECOND != 0) {
        promise.reject(IllegalArgumentException(INVALID_RATE)); return@post
      }
      if (!OnDeviceAudioOwnership.acquire(this)) {
        promise.reject(IllegalStateException(ALREADY_LISTENING)); return@post
      }
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val link = Session(inputRate.toInt(), outputRate.toInt(), onInput, onLevel, onStopped, manager)
      session = link
      try {
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attributes).setOnAudioFocusChangeListener({ change ->
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
              change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) lost(link, FOCUS_LOST)
          }, main).build()
        link.focus = focus
        check(manager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { FOCUS_UNAVAILABLE }
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        link.changedMode = true
        val inputMinimum = AudioRecord.getMinBufferSize(link.inputRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val outputMinimum = AudioTrack.getMinBufferSize(link.outputRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        require(inputMinimum > 0 && outputMinimum > 0) { INVALID_RATE }
        link.record = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, link.inputRate,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
          maxOf(inputMinimum, link.inputRate / CHUNKS_PER_SECOND * BYTES_PER_SAMPLE * BUFFER_CHUNKS))
        val record = requireNotNull(link.record)
        check(record.state == AudioRecord.STATE_INITIALIZED) { INPUT_UNAVAILABLE }
        if (AcousticEchoCanceler.isAvailable()) {
          link.echo = AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true }
        }
        if (NoiseSuppressor.isAvailable()) {
          link.noise = NoiseSuppressor.create(record.audioSessionId)?.apply { enabled = true }
        }
        link.track = AudioTrack.Builder().setAudioAttributes(attributes).setAudioFormat(AudioFormat.Builder()
          .setSampleRate(link.outputRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
          .setBufferSizeInBytes(maxOf(outputMinimum, link.outputRate / CHUNKS_PER_SECOND * BYTES_PER_SAMPLE * BUFFER_CHUNKS))
          .setTransferMode(AudioTrack.MODE_STREAM).build()
        check(link.track?.state == AudioTrack.STATE_INITIALIZED) { OUTPUT_UNAVAILABLE }
        record.startRecording()
        check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { INPUT_UNAVAILABLE }
        link.track?.play()
        link.reader = Thread({ read(link) }, READER_THREAD).apply { start() }
        link.writer = Thread({ write(link) }, WRITER_THREAD).apply { start() }
        promise.resolve(Unit)
      } catch (error: Exception) {
        close(link)
        promise.reject(error)
      }
    }
    return promise
  }

  private fun read(link: Session) {
    val record = requireNotNull(link.record)
    val samples = ShortArray(link.inputRate / CHUNKS_PER_SECOND)
    var filled = 0
    var level = 0.0
    var lastLevel = 0L
    try {
      while (link.active) {
        val count = record.read(samples, filled, samples.size - filled, AudioRecord.READ_BLOCKING)
        if (!link.active) break
        check(count > 0) { INPUT_LOST }
        filled += count
        if (filled < samples.size) continue
        filled = 0
        val bytes = ByteArray(samples.size * BYTES_PER_SAMPLE)
        var energy = 0.0
        samples.forEachIndexed { index, sample ->
          bytes[index * BYTES_PER_SAMPLE] = sample.toByte()
          bytes[index * BYTES_PER_SAMPLE + 1] = (sample.toInt() shr BYTE_BITS).toByte()
          val amplitude = sample.toDouble() / PCM_SCALE
          energy += amplitude * amplitude
        }
        val rms = sqrt(energy / samples.size)
        val db = if (rms > 0) 20 * log10(rms) else NOISE_FLOOR_DB
        val target = ((db - NOISE_FLOOR_DB) / (CEILING_DB - NOISE_FLOOR_DB)).coerceIn(0.0, 1.0)
        val smoothing = if (target > level) ATTACK_SECONDS else RELEASE_SECONDS
        level += (target - level) * (1 - exp(-1.0 / CHUNKS_PER_SECOND / smoothing))
        if (target == 0.0 && level < SILENCE_THRESHOLD) level = 0.0
        val now = System.nanoTime()
        val emitLevel = now - lastLevel >= LEVEL_INTERVAL_NS
        if (emitLevel) lastLevel = now
        val currentLevel = level
        val chunk = Base64.encodeToString(bytes, Base64.NO_WRAP)
        main.post {
          if (session === link && link.active) {
            if (emitLevel) link.onLevel(currentLevel)
            link.onInput(chunk)
          }
        }
      }
    } catch (_: Exception) { main.post { lost(link, INPUT_LOST) } }
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
    require(bytes.size % BYTES_PER_SAMPLE == 0) { INVALID_CHUNK }
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
      link.lastHead = 0
      link.headWraps = 0
      link.track?.play()
    }
  }

  override fun playedMs(): Double {
    val link = session ?: return 0.0
    return synchronized(link.outputLock) {
      if (!link.active) return@synchronized 0.0
      val head = (link.track?.playbackHeadPosition ?: 0).toLong() and PLAYBACK_HEAD_MASK
      if (head < link.lastHead) link.headWraps += PLAYBACK_HEAD_RANGE
      link.lastHead = head
      (link.headWraps + head).toDouble() / link.outputRate * MILLISECONDS_PER_SECOND
    }
  }

  private fun lost(link: Session, reason: String) {
    if (session !== link || !link.active) return
    close(link)
    link.onStopped(reason)
  }

  private fun close(link: Session) {
    if (session === link) session = null
    synchronized(link.outputLock) {
      link.active = false
      link.outputGeneration++
      link.queue.clear()
      runCatching { link.track?.pause(); link.track?.flush() }
    }
    // Stop unblocks a blocking microphone read before its resources are released.
    runCatching { link.record?.stop() }
    link.reader?.interrupt()
    link.writer?.interrupt()
    runCatching { link.reader?.join(THREAD_JOIN_MS); link.writer?.join(THREAD_JOIN_MS) }
    runCatching { link.echo?.release() }
    runCatching { link.noise?.release() }
    runCatching { link.record?.release() }
    synchronized(link.outputLock) {
      runCatching { link.track?.release() }
      link.track = null
    }
    runCatching { link.focus?.let { link.manager.abandonAudioFocusRequest(it) } }
    try {
      if (link.changedMode) link.manager.mode = link.previousMode
    } finally { OnDeviceAudioOwnership.release(this) }
  }

  override fun stop() { main.post { session?.let(::close) } }
  override fun dispose() { stop(); super.dispose() }

  companion object {
    private const val CHUNKS_PER_SECOND = 10
    private const val BYTES_PER_SAMPLE = 2
    private const val BYTE_BITS = 8
    private const val BUFFER_CHUNKS = 2
    private const val PCM_SCALE = 32768.0
    private const val MINIMUM_RATE = 8000.0
    private const val MAXIMUM_RATE = 192000.0
    private const val MILLISECONDS_PER_SECOND = 1000.0
    private const val NOISE_FLOOR_DB = -50.0
    private const val CEILING_DB = -10.0
    private const val ATTACK_SECONDS = 0.035
    private const val RELEASE_SECONDS = 0.18
    private const val SILENCE_THRESHOLD = 0.005
    private const val LEVEL_INTERVAL_NS = 33_333_334L
    private const val WRITER_RETRY_MS = 5L
    private const val THREAD_JOIN_MS = 250L
    private const val PLAYBACK_HEAD_MASK = 0xffff_ffffL
    private const val PLAYBACK_HEAD_RANGE = 0x1_0000_0000L
    private const val READER_THREAD = "FieldGuideAudioInput"
    private const val WRITER_THREAD = "FieldGuideAudioOutput"
    private const val INVALID_RATE = "Audio link requires supported whole sample rates and 100 ms input chunks"
    private const val PERMISSION_REQUIRED = "Microphone permission required for audio link"
    private const val ALREADY_LISTENING = "Speech input or audio link is already listening"
    private const val INVALID_CHUNK = "Audio link requires base64 little-endian PCM16"
    private const val INPUT_UNAVAILABLE = "Audio link microphone is unavailable"
    private const val OUTPUT_UNAVAILABLE = "Audio link player is unavailable"
    private const val INPUT_LOST = "Audio link microphone stopped"
    private const val OUTPUT_LOST = "Audio link playback stopped"
    private const val FOCUS_UNAVAILABLE = "Audio link could not obtain audio focus"
    private const val FOCUS_LOST = "Audio focus lost"
    private fun validRate(rate: Double) = rate.isFinite() && rate >= MINIMUM_RATE && rate <= MAXIMUM_RATE && rate % 1.0 == 0.0
  }
}

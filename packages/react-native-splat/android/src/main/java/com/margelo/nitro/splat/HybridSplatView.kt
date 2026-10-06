package com.margelo.nitro.splat

import android.content.Context
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import android.view.TextureView
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.util.concurrent.Executors

class HybridSplatView(context: Context) : HybridSplatViewSpec(), TextureView.SurfaceTextureListener, LifecycleEventListener {
  constructor() : this(requireNotNull(NitroModules.applicationContext))

  private val texture = TextureView(context)
  private val reactContext = context as? ReactContext
  override val view: View = texture
  private val thread = HandlerThread("FieldGuideRender").apply { start() }
  private val render = Handler(thread.looper)
  private val workers = Executors.newSingleThreadExecutor()
  @Volatile private var engine = 0L
  @Volatile private var dropped = false
  @Volatile private var active = true
  private var scheduled = false
  private var choreographer: Choreographer? = null
  private var loaded: SplatSource? = null
  private var loadStarted = 0L
  private val frameCallback = object : Choreographer.FrameCallback {
    override fun doFrame(frameTimeNanos: Long) {
      scheduled = false
      if (!dropped && active && texture.isAttachedToWindow && SplatEngine.draw(engine, frameTimeNanos)) wake()
    }
  }

  override var source = SplatSource("", "", "", "", 0.0)
  override var highlight = doubleArrayOf()
  override var cameraLimits: CameraLimits? = null
  override var revealSeconds: Double? = null
  override var onReady: () -> Unit = {}
  override var onError: (SplatError) -> Unit = {}

  init {
    reactContext?.addLifecycleEventListener(this)
    texture.surfaceTextureListener = this
    render.post {
      choreographer = Choreographer.getInstance()
      engine = SplatEngine.create(this)
      if (engine == 0L) nativeEvent(EVENT_GPU_UNAVAILABLE, VULKAN_INITIALIZATION_FAILED, 0)
    }
    texture.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(view: View) { post {} }
      override fun onViewDetachedFromWindow(view: View) {
        render.post { choreographer?.removeFrameCallback(frameCallback); scheduled = false }
      }
    })
  }

  override fun afterUpdate() {
    val limits = cameraLimits?.let {
      floatArrayOf(it.minAzimuth.toFloat(), it.maxAzimuth.toFloat(), it.minElevation.toFloat(),
        it.maxElevation.toFloat(), it.minRadius.toFloat(), it.maxRadius.toFloat())
    }
    val labels = highlight.filter { it.isFinite() && it in 1.0..255.0 && it % 1.0 == 0.0 }
      .map { it.toInt().toByte() }.toByteArray()
    val seconds = (revealSeconds ?: 0.0).toFloat()
    val input = source
    post {
      SplatEngine.limits(engine, limits)
      SplatEngine.highlight(engine, labels)
      SplatEngine.reveal(engine, seconds)
      if (input != loaded && input.splatPath.isNotEmpty()) {
        loaded = input
        loadStarted = System.nanoTime()
        val id = engine
        val request = SplatEngine.beginLoad(id)
        workers.execute {
          try {
            val files = BundledPack.resolve(texture.context, input)
            require(files.expectedSplatCount.isFinite() && files.expectedSplatCount in 1.0..MAX_SPLAT_COUNT &&
              files.expectedSplatCount % 1.0 == 0.0) { "Invalid source splat count" }
            SplatEngine.load(id, request, files.splatPath, files.labelsPath,
              files.splatSha256, files.labelsSha256, files.expectedSplatCount.toLong())
          } catch (error: Exception) {
            if (!dropped && loaded == input) nativeEvent(EVENT_LOAD_FAILED, error.message ?: PACK_LOADING_FAILED, 0)
          }
          post {}
        }
      }
    }
  }

  private fun post(action: () -> Unit) {
    if (dropped) return
    render.post { if (!dropped && engine != 0L) { action(); wake() } }
  }

  private fun wake() {
    if (scheduled || dropped || !active || !texture.isAttachedToWindow) return
    scheduled = true
    choreographer?.postFrameCallback(frameCallback)
  }

  @Keep @DoNotStrip
  fun nativeEvent(code: Int, message: String, count: Int) {
    if (dropped) return
    if (code == EVENT_READY) {
      Log.i(TAG, "Pack ready: $count splats, ${(System.nanoTime() - loadStarted) / 1_000_000} ms")
      render.post { Log.i(TAG, "GPU frame: ${SplatEngine.gpuMillis(engine)} ms") }
      onReady()
    } else {
      val error = when (code) {
        EVENT_LABELS_MISMATCH -> SplatErrorCode.LABELS_MISMATCH
        EVENT_GPU_UNAVAILABLE -> SplatErrorCode.GPU_UNAVAILABLE
        else -> SplatErrorCode.LOAD_FAILED
      }
      Log.e(TAG, message)
      onError(SplatError(error, message))
    }
  }

  override fun orbit(dAzimuth: Double, dElevation: Double) = post {
    SplatEngine.orbit(engine, dAzimuth.toFloat(), dElevation.toFloat())
  }
  override fun dolly(factor: Double) = post { SplatEngine.dolly(engine, factor.toFloat()) }
  override fun frame(bounds: Bounds, seconds: Double, from: ViewDirection?) = post {
    SplatEngine.frame(engine, floatArrayOf(bounds.min.x.toFloat(), bounds.min.y.toFloat(), bounds.min.z.toFloat(),
      bounds.max.x.toFloat(), bounds.max.y.toFloat(), bounds.max.z.toFloat()), seconds.toFloat(),
      from?.let { floatArrayOf(it.azimuth.toFloat(), it.elevation.toFloat()) })
  }
  override fun pick(x: Double, y: Double): Promise<Double> = Promise.parallel {
    SplatEngine.pick(engine, x.toFloat(), y.toFloat()).toDouble()
  }
  override fun project(points: ArrayBuffer, out: ArrayBuffer): Double {
    require(points.size % 12 == 0 && out.size >= points.size / 12 * 8) { "Invalid projection buffers" }
    return SplatEngine.project(engine, points.getBuffer(false), out.getBuffer(false)).toDouble()
  }
  override fun drawnDirection(): ViewDirection? = SplatEngine.direction(engine)?.let {
    ViewDirection(it[0].toDouble(), it[1].toDouble())
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    val window = Surface(surface)
    post { try { SplatEngine.surface(engine, window) } finally { window.release() } }
  }
  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = post {
    SplatEngine.resize(engine, width, height)
  }
  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    post { SplatEngine.surface(engine, null) }
    return true
  }
  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}

  override fun onHostResume() { active = true; post {} }
  override fun onHostPause() {
    active = false
    render.post { choreographer?.removeFrameCallback(frameCallback); scheduled = false }
  }
  override fun onHostDestroy() { onHostPause() }

  override fun onDropView() {
    if (dropped) return
    dropped = true
    reactContext?.removeLifecycleEventListener(this)
    onReady = {}
    onError = {}
    render.post {
      choreographer?.removeFrameCallback(frameCallback)
      SplatEngine.destroy(engine)
      engine = 0L
      thread.quitSafely()
    }
    workers.shutdown()
  }

  companion object {
    private const val TAG = "FieldGuideSplat"
    private const val EVENT_READY = 0
    private const val EVENT_LOAD_FAILED = 1
    private const val EVENT_LABELS_MISMATCH = 2
    private const val EVENT_GPU_UNAVAILABLE = 3
    private const val VULKAN_INITIALIZATION_FAILED = "Vulkan initialization failed"
    private const val PACK_LOADING_FAILED = "Pack loading failed"
    private const val MAX_SPLAT_COUNT = 4294967295.0
  }
}

package com.splatkit.ui

import android.content.Context
import android.graphics.Typeface
import android.util.AttributeSet
import android.util.TypedValue
import android.widget.TextView
import com.splatkit.SplatStats
import com.splatkit.SplatSurfaceView
import java.util.Locale

/**
 * A small monospace overlay with the GPU, frame rate, sort time and splat count.
 * Attach it to a [SplatSurfaceView] and it polls the stats four times a second.
 */
class SplatHudView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : TextView(context, attrs) {

    private var target: SplatSurfaceView? = null
    private val stats = SplatStats()

    private val tick = object : Runnable {
        override fun run() {
            refresh()
            postDelayed(this, 250)
        }
    }

    init {
        typeface = Typeface.MONOSPACE
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setTextColor(0xFFFFFFFF.toInt())
        setBackgroundColor(0x80000000.toInt())
        val pad = (8 * resources.displayMetrics.density).toInt()
        setPadding(pad, pad, pad, pad)
    }

    fun attach(view: SplatSurfaceView) {
        target = view
        removeCallbacks(tick)
        post(tick)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    private fun refresh() {
        val view = target ?: return
        view.readStats(stats)
        val mode = if (stats.walking) "walk" else "fly"
        val input = if (stats.motion) "gyro" else "touch"
        // The engine draws only when something changed, so a still scene reads as idle.
        val frame = if (stats.fps > 0f) {
            String.format(Locale.US, "%5.1f fps  %5.1f ms  gpu %5.1f ms", stats.fps, stats.frameMillis, stats.gpuMillis)
        } else {
            "idle, last gpu ${String.format(Locale.US, "%.1f", stats.gpuMillis)} ms"
        }
        text = String.format(
            Locale.US,
            "%s\n%s\nsort %5.1f ms\n%,d drawn / %,d loaded\n%s, %s",
            view.gpuDescription, frame, stats.sortMillis,
            stats.drawnSplatCount, stats.loadedSplatCount, mode, input,
        )
    }
}

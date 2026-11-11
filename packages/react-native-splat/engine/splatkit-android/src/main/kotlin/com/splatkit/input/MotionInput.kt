package com.splatkit.input

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.view.Display
import android.view.Surface

/**
 * Turns the phone's orientation into a camera attitude.
 *
 * Uses TYPE_GAME_ROTATION_VECTOR: accelerometer plus gyroscope, no magnetometer, so it
 * is immune to magnetic interference and its heading is arbitrary, the same trade as
 * CoreMotion's arbitrary-Z-vertical frame. The rotation matrix maps device axes to the
 * East-North-Up reference; it is remapped for the display rotation so landscape works.
 */
internal class MotionInput(
    context: Context,
    private val handler: Handler,
    private val onAttitude: (FloatArray) -> Unit,
) : SensorEventListener {
    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
    private val raw = FloatArray(9)
    private val remapped = FloatArray(9)
    var displayRotation: Int = Surface.ROTATION_0

    val isAvailable: Boolean get() = sensor != null

    fun start() {
        sensor?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, handler) }
    }

    fun stop() = sensorManager.unregisterListener(this)

    override fun onSensorChanged(event: SensorEvent) {
        SensorManager.getRotationMatrixFromVector(raw, event.values)
        // Remap so that "device X right, Y up on screen" holds in the current orientation.
        val (axisX, axisY) = when (displayRotation) {
            Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
            Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
            Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
            else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
        SensorManager.remapCoordinateSystem(raw, axisX, axisY, remapped)
        onAttitude(remapped)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}

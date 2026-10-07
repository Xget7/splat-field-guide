package com.margelo.nitro.ondevice

import android.Manifest
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.Promise

internal object MicrophonePermission {
  private const val PERMISSION_REQUEST = 8711
  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val main = Handler(Looper.getMainLooper())

  fun request(): Promise<SpeechPermission> {
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
}

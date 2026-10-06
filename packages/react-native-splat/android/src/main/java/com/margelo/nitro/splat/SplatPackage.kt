package com.margelo.nitro.splat

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.splat.views.HybridSplatViewManager

class SplatPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = emptyList()
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(HybridSplatViewManager())
  companion object {
    init { System.loadLibrary("reactnativesplat") }
  }
}

package com.margelo.nitro.ondevice

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.TelephonyManager
import com.margelo.nitro.NitroModules

class HybridNetworkMonitor : HybridNetworkMonitorSpec() {
  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val main = Handler(Looper.getMainLooper())
  private var callback: ConnectivityManager.NetworkCallback? = null

  override fun start(onChange: (NetworkPath) -> Unit) {
    main.post {
      stopOnMain()
      val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val observer = object : ConnectivityManager.NetworkCallback() {
        private var current = manager.activeNetwork
        override fun onAvailable(network: Network) { current = network }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
          if (callback === this && network == current) onChange(path(capabilities))
        }
        override fun onLost(network: Network) {
          if (callback === this && network == current) {
            current = null
            onChange(path(null))
          }
        }
      }
      callback = observer
      manager.registerDefaultNetworkCallback(observer, main)
      onChange(path(manager.activeNetwork?.let(manager::getNetworkCapabilities)))
    }
  }

  private fun path(capabilities: NetworkCapabilities?): NetworkPath {
    if (capabilities == null) return NetworkPath(false, NetworkTransport.NONE, false, false, UNKNOWN, UNKNOWN)
    val satisfied = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
      capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    val transport = when {
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkTransport.WIFI
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkTransport.CELLULAR
      capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkTransport.WIRED
      else -> NetworkTransport.OTHER
    }
    val signal = try {
      when (transport) {
        NetworkTransport.WIFI -> {
          val strength = capabilities.signalStrength
          if (strength == NetworkCapabilities.SIGNAL_STRENGTH_UNSPECIFIED) UNKNOWN
          else if (Build.VERSION.SDK_INT >= 30) {
            val wifi = context.getSystemService(Context.WIFI_SERVICE) as WifiManager
            wifi.calculateSignalLevel(strength).coerceIn(0, MAX_SIGNAL_LEVEL).toDouble()
          } else {
            @Suppress("DEPRECATION")
            WifiManager.calculateSignalLevel(strength, SIGNAL_LEVELS).toDouble()
          }
        }
        NetworkTransport.CELLULAR -> {
          val phone = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
          phone.signalStrength?.level?.toDouble() ?: UNKNOWN
        }
        else -> UNKNOWN
      }
    } catch (_: SecurityException) { UNKNOWN }
    return NetworkPath(satisfied, transport,
      !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED), false,
      capabilities.linkDownstreamBandwidthKbps.toDouble(), signal)
  }

  private fun stopOnMain() {
    callback?.let {
      val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      manager.unregisterNetworkCallback(it)
    }
    callback = null
  }
  override fun stop() { main.post { stopOnMain() } }
  override fun dispose() { stop(); super.dispose() }

  companion object {
    private const val UNKNOWN = -1.0
    private const val SIGNAL_LEVELS = 5
    private const val MAX_SIGNAL_LEVEL = SIGNAL_LEVELS - 1
  }
}

package com.margelo.nitro.ondevice

import com.margelo.nitro.core.Promise

class HybridLanguageModel : HybridLanguageModelSpec() {
  override fun availability() = LanguageModelAvailability.UNAVAILABLE
  override fun prewarm(instructions: String) {}
  override fun respond(instructions: String, prompt: String, onPartial: (String) -> Unit): Promise<String> =
    Promise.rejected(IllegalStateException(UNAVAILABLE_MESSAGE))
  override fun cancel() {}

  companion object { private const val UNAVAILABLE_MESSAGE = "On-device generation is unavailable on Android" }
}

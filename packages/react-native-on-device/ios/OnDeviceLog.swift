import Foundation
import os

enum OnDeviceLog {
  private static let model = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "LanguageModel")
  private static let speech = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "SpeechInput")

  static func languageModel(_ error: Error) {
    model.error("\(error.localizedDescription, privacy: .public)")
  }

  static func speechInput(_ error: Error) {
    let native = error as NSError
    speech.error("\(native.domain, privacy: .public) (\(native.code)): \(native.localizedDescription, privacy: .public)")
  }
}

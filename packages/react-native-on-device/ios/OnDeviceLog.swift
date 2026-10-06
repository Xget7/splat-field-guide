import Foundation
import os

enum OnDeviceLog {
  private static let model = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "LanguageModel")
  private static let speech = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "SpeechInput")
  private static let output = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "SpeechOutput")
#if DEBUG
  private static let measurementWriter = DispatchQueue(label: "dev.splatfieldguide.kokoro.measurements")
#endif

  static func speechOutput(_ message: String) {
    output.notice("\(message, privacy: .public)")
#if DEBUG
    speechMeasurement("speech_output=\(message)")
#endif
  }

  static func speechMeasurement(_ message: String) {
#if DEBUG
    output.notice("\(message, privacy: .public)")
    print("[Kokoro] \(message)")
    measurementWriter.async {
      guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
        let data = (message + "\n").data(using: .utf8) else { return }
      let file = caches.appendingPathComponent("KokoroMeasurements.log")
      do {
        if !FileManager.default.fileExists(atPath: file.path) { try Data().write(to: file) }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
      } catch { output.error("Unable to save Kokoro measurement: \(error.localizedDescription, privacy: .public)") }
    }
#endif
  }

  static func languageModel(_ error: Error) {
    model.error("\(error.localizedDescription, privacy: .public)")
  }

  static func speechInput(_ error: Error) {
    let native = error as NSError
    speech.error("\(native.domain, privacy: .public) (\(native.code)): \(native.localizedDescription, privacy: .public)")
  }
}

struct KokoroFrontendLog {
  func warning(_ message: String) { OnDeviceLog.speechOutput(message) }
  func info(_ message: String) { OnDeviceLog.speechMeasurement(message) }
}

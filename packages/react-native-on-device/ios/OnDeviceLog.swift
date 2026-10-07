import Foundation
import os

enum OnDeviceLog {
  private static let model = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "LanguageModel")
  private static let speech = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "SpeechInput")
  private static let output = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "SpeechOutput")
  private static let conversation = Logger(
    subsystem: "dev.splatfieldguide.ondevice", category: "Voice")
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

  private static let voiceFile = VoiceLogFile()

  /// Conversation milestones, also kept in the app's caches so a device session can be read afterwards.
  static func voice(_ message: String) {
    conversation.notice("\(message, privacy: .public)")
    voiceFile.append(message)
  }

  fileprivate static func voiceFileFailed(_ error: Error) {
    conversation.error("Unable to save the voice log: \(error.localizedDescription, privacy: .public)")
  }

  static func languageModel(_ error: Error) {
    model.error("\(error.localizedDescription, privacy: .public)")
  }

  static func speechInput(_ error: Error) {
    let native = error as NSError
    speech.error("\(native.domain, privacy: .public) (\(native.code)): \(native.localizedDescription, privacy: .public)")
  }
}

// Two bounded files: the current one and the one it replaced.
private final class VoiceLogFile {
  private static let name = "VoiceLog.txt"
  private static let previousName = "VoiceLog.previous.txt"
  private static let limit: UInt64 = 1_000_000
  private let writer = DispatchQueue(label: "dev.splatfieldguide.voice.log", qos: .utility)
  private let time: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "HH:mm:ss.SSS"
    return formatter
  }()

  func append(_ message: String) {
    let date = Date()
    writer.async {
      guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
        let data = "\(self.time.string(from: date)) \(message)\n".data(using: .utf8) else { return }
      let file = caches.appendingPathComponent(Self.name)
      do {
        let manager = FileManager.default
        if let size = try? manager.attributesOfItem(atPath: file.path)[.size] as? UInt64,
          size > Self.limit {
          let previous = caches.appendingPathComponent(Self.previousName)
          try? manager.removeItem(at: previous)
          try manager.moveItem(at: file, to: previous)
        }
        if !manager.fileExists(atPath: file.path) { try Data().write(to: file) }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
      } catch { OnDeviceLog.voiceFileFailed(error) }
    }
  }
}

struct KokoroFrontendLog {
  func warning(_ message: String) { OnDeviceLog.speechOutput(message) }
  func info(_ message: String) { OnDeviceLog.speechMeasurement(message) }
}

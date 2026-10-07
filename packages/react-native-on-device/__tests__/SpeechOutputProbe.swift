import AVFoundation
import NitroModules

struct OnDeviceError: Error { let message: String }
enum OnDeviceAudioSession { static func activate() throws {} }
enum OnDeviceLog {
  static func speechOutput(_ message: String) {}
  static func speechMeasurement(_ message: String) {}
  static func voice(_ message: String) {}
}

// Keep the platform audio sink unopened while exercising voice preparation.
final class OnDeviceAudioGraph {
  static let shared = OnDeviceAudioGraph()
  static let didInterruptPlayback = Notification.Name("ProbeAudioInterrupted")
  var player: AVAudioPlayerNode { fatalError("Preparation must not open playback") }
  var engine: AVAudioEngine { fatalError("Preparation must not open playback") }
  func startPlayback() throws {}
  func stopPlayback() {}
}
final class KokoroCancellation {
  var isCancelled = false
  func cancel() { isCancelled = true }
}
final class KokoroEngine {
  static let sampleRate = 24_000.0
  private static let lock = NSLock()
  private static var loads = 0
  static var loaded: Bool { lock.withLock { loads > 0 } }
  init() throws {
    Self.lock.withLock { Self.loads += 1 }
    if CommandLine.arguments.last == "failure" { throw OnDeviceError(message: "Missing model") }
  }
  func synthesize(_ text: String, cancellation: KokoroCancellation) throws -> AVAudioPCMBuffer {
    let format = AVAudioFormat(standardFormatWithSampleRate: Self.sampleRate, channels: 1)!
    return AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1)!
  }
}

@main
struct SpeechOutputProbe {
  static func main() throws {
    let output = HybridSpeechOutput()
    let systemOnly = CommandLine.arguments.last == "system"
    let promise = try output.prepare(voice: systemOnly ? .system : .kokoro)
    let deadline = Date().addingTimeInterval(2)
    while !promise.settled && Date() < deadline {
      RunLoop.main.run(until: Date().addingTimeInterval(0.001))
    }
    if systemOnly { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
    let voice = promise.result == .kokoro ? "kokoro" : promise.result == .system ? "system" : "pending"
    let result: [String: Any] = ["voice": voice, "loaded": KokoroEngine.loaded]
    print(String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self))
  }
}

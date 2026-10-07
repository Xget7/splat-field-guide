import AVFoundation
import NitroModules

struct OnDeviceError: Error { let message: String }

// Substitute the iOS-only session notifications while retaining the real, unstarted AVAudioEngine.
enum OnDeviceAudioSession { static func activate() throws {} }
enum AVAudioSession {
  static let interruptionNotification = Notification.Name("AVAudioSessionInterruptionNotification")
  enum InterruptionType: UInt { case began = 1, ended = 0 }
}
let AVAudioSessionInterruptionTypeKey = "AVAudioSessionInterruptionTypeKey"

enum OnDeviceLog {
  static func speechOutput(_ message: String) {}
  static func speechMeasurement(_ message: String) {}
}

final class KokoroCancellation {
  private let lock = NSLock()
  private var cancelled = false
  var isCancelled: Bool { lock.withLock { cancelled } }
  func cancel() { lock.withLock { cancelled = true } }
}

// Pause synthesis before audio exists to verify cancellation independently of playback.
final class KokoroEngine {
  static let sampleRate = 24_000.0
  static let synthesizing = DispatchSemaphore(value: 0)
  static let released = DispatchSemaphore(value: 0)
  init() throws {}
  func synthesize(_ text: String, cancellation: KokoroCancellation) throws -> AVAudioPCMBuffer {
    if text != "Ready." {
      Self.synthesizing.signal()
      Self.released.wait()
      throw OnDeviceError(message: "Cancelled model")
    }
    let format = AVAudioFormat(standardFormatWithSampleRate: Self.sampleRate, channels: 1)!
    return AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1)!
  }
}

final class ControlledAudio: ConversationAudio {
  private var tap: AVAudioNodeTapBlock?
  private var stopped: ((String) -> Void)?
  let format = AVAudioFormat(standardFormatWithSampleRate: 24_000, channels: 1)!
  func startListening(onStopped: @escaping (String) -> Void,
    tap: @escaping AVAudioNodeTapBlock) throws -> AVAudioFormat {
    self.tap = tap
    stopped = onStopped
    return format
  }
  func stopListening() { tap = nil }
  func loseAudio() { stopped?("Audio session interrupted") }
  func feed(level: Double, tick: Int) {
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1200)!
    buffer.frameLength = 1200
    let amplitude = Float(pow(10, (-50 + level * 40) / 20))
    for frame in 0..<1200 { buffer.floatChannelData![0][frame] = amplitude }
    tap?(buffer, AVAudioTime(hostTime: AVAudioTime.hostTime(forSeconds: Double(tick) * 0.05)))
    RunLoop.main.run(until: Date().addingTimeInterval(0.0001))
  }
}

final class ControlledTranscription: ConversationTranscription {
  var onChange: (String) -> Void = { _ in }
  var onEnd: (Error?) -> Void = { _ in }
  var pendingTurn: ((String) -> Void)?
  func append(_ buffer: AVAudioPCMBuffer) {}
  func endTurn(_ done: @escaping (String) -> Void) { pendingTurn = done }
  func cancel() {}
}

@main
struct ConversationProbe {
  static func main() throws {
    if CommandLine.arguments.last == "output" {
      let output = HybridSpeechOutput()
      let promise = try output.speak(text: "Check coolant", locale: "en-US", onWord: { _, _ in
        preconditionFailure("No audio has played")
      }, voice: .kokoro)
      let deadline = Date().addingTimeInterval(5)
      while KokoroEngine.synthesizing.wait(timeout: .now()) != .success {
        precondition(Date() < deadline, "Output did not begin synthesis")
        RunLoop.main.run(until: Date().addingTimeInterval(0.001))
      }
      precondition(!promise.settled)
      NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange,
        object: OnDeviceAudioGraph.shared.engine)
      KokoroEngine.released.signal()
      RunLoop.main.run(until: Date().addingTimeInterval(0.02))
      print(promise.settled ? "[\"stopped before playback\"]" : "[]")
      return
    }
    if CommandLine.arguments.last == "graph" {
      let graph = OnDeviceAudioGraph.shared
      var events: [String] = []
      let center = NotificationCenter.default
      let observer = center.addObserver(forName: OnDeviceAudioGraph.didInterruptPlayback,
        object: nil, queue: .main) { _ in events.append("playback stopped") }
      let previous = graph.engine
      center.post(name: .AVAudioEngineConfigurationChange, object: previous)
      center.post(name: .AVAudioEngineConfigurationChange, object: previous)
      center.post(name: AVAudioSession.interruptionNotification, object: nil,
        userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue])
      center.post(name: AVAudioSession.interruptionNotification, object: nil,
        userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
      center.removeObserver(observer)
      print(String(decoding: try JSONSerialization.data(withJSONObject: events), as: UTF8.self))
      return
    }
    let audio = ControlledAudio()
    var models: [ControlledTranscription] = []
    let conversation = OnDeviceConversation(audio: audio) { _, _, change, end in
      let model = ControlledTranscription()
      model.onChange = change
      model.onEnd = end
      models.append(model)
      return model
    }
    var events: [String] = []
    var tick = 0
    func listen() throws {
      try conversation.listen(locale: "en-US", hints: ["coolant"],
        onPartial: { events.append("partial:\($0)") },
        onTurn: { events.append("turn:\($0):\(tick)") }, onLevel: { _ in },
        onVoice: { events.append("voice:\($0):\(tick)") },
        onStopped: { events.append("stopped:\($0)") })
    }
    try listen()
    models[0].onChange("Check coolant")
    for current in 0..<200 {
      tick = current
      audio.feed(level: current < 20 ? 0 : 0.7, tick: current)
    }
    if CommandLine.arguments.last == "sustained" {
      for current in 200..<230 {
        tick = current
        audio.feed(level: 0, tick: current)
      }
      models[0].pendingTurn?(" Check coolant ")
    } else {
      if CommandLine.arguments.last == "cancel" { conversation.cancel() }
      else { audio.loseAudio() }
      models[0].onChange("stale")
      models[0].pendingTurn?("stale")
      models[0].onEnd(nil)
      try listen()
      models[1].onChange("Restarted")
      conversation.cancel()
    }
    let data = try JSONSerialization.data(withJSONObject: events)
    print(String(decoding: data, as: UTF8.self))
  }
}

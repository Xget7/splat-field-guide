import AVFoundation

struct OnDeviceError: Error { let message: String }

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

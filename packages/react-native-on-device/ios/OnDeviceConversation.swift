import AVFoundation

protocol ConversationAudio: AnyObject {
  func startListening(onStopped: @escaping (String) -> Void,
    tap: @escaping AVAudioNodeTapBlock) throws -> AVAudioFormat
  func stopListening()
}

protocol ConversationTranscription: AnyObject {
  func append(_ buffer: AVAudioPCMBuffer)
  func endTurn(_ done: @escaping (String) -> Void)
  func cancel()
}

// Lifecycle and callbacks belong to main; level detection belongs to the audio tap.
final class OnDeviceConversation {
  typealias Transcribe = (String, [String], @escaping (String) -> Void,
    @escaping (Error?) -> Void) throws -> any ConversationTranscription
  static let recognitionEnded = "Speech recognition ended"

  private final class Listening {
    let levels = OnDeviceAudioLevel()
    let voice = OnDeviceVoiceActivity()
    var transcription: (any ConversationTranscription)?
    let onPartial: (String) -> Void
    let onTurn: (String) -> Void
    let onVoice: (Bool) -> Void
    let onStopped: (String) -> Void
    // The loudest level since the last log line, and when that line was written.
    var peak = 0.0
    var loggedAt: TimeInterval = 0

    init(onPartial: @escaping (String) -> Void, onTurn: @escaping (String) -> Void,
      onVoice: @escaping (Bool) -> Void, onStopped: @escaping (String) -> Void) {
      self.onPartial = onPartial
      self.onTurn = onTurn
      self.onVoice = onVoice
      self.onStopped = onStopped
    }
  }

  private let audio: any ConversationAudio
  private let transcribe: Transcribe
  private var listening: Listening?

  init(audio: any ConversationAudio, transcribe: @escaping Transcribe) {
    self.audio = audio
    self.transcribe = transcribe
  }

  func listen(locale: String, hints: [String], onPartial: @escaping (String) -> Void,
    onTurn: @escaping (String) -> Void, onLevel: @escaping (Double) -> Void,
    onVoice: @escaping (Bool) -> Void, onStopped: @escaping (String) -> Void) throws {
    guard listening == nil else { throw OnDeviceError(message: OnDeviceError.alreadyListening) }
    let current = Listening(onPartial: onPartial, onTurn: onTurn, onVoice: onVoice,
      onStopped: onStopped)
    listening = current
    do {
      let transcription = try transcribe(locale, hints, { [weak self, weak current] text in
        guard let self, let current, self.listening === current else { return }
        current.onPartial(text)
      }, { [weak self, weak current] error in
        self?.stopped(current, reason: error?.localizedDescription ?? Self.recognitionEnded)
      })
      current.transcription = transcription
      _ = try audio.startListening(onStopped: { [weak self, weak current] reason in
        self?.stopped(current, reason: reason)
      }) { [weak self, weak current, levels = current.levels, voice = current.voice] buffer, time in
        transcription.append(buffer)
        guard let level = levels.update(buffer, at: time.hostTime) else { return }
        let change = voice.update(level, at: AVAudioTime.seconds(forHostTime: time.hostTime))
        let threshold = voice.threshold
        DispatchQueue.main.async {
          guard let self, let current, self.listening === current else { return }
          onLevel(level)
          Self.logLevel(level, threshold: threshold, in: current)
          if let change { self.voiceChanged(change, in: current) }
        }
      }
    } catch {
      cancel()
      throw error
    }
  }

  /// Stops explicitly without a spontaneous-stop callback or late transcript callbacks.
  func cancel() {
    guard let current = listening else { return }
    listening = nil
    current.transcription?.cancel()
    current.transcription = nil
    audio.stopListening()
  }

  private func stopped(_ current: Listening?, reason: String) {
    guard let current, listening === current else { return }
    OnDeviceLog.voice("Listening stopped: \(reason)")
    cancel()
    current.onVoice(false)
    current.onStopped(reason)
  }

  private func voiceChanged(_ change: OnDeviceVoiceActivity.Change, in current: Listening) {
    switch change {
    case .started:
      OnDeviceLog.voice("Voice started")
      current.onVoice(true)
    case .ended:
      OnDeviceLog.voice("Voice ended, finalizing the turn")
      current.onVoice(false)
      current.transcription?.endTurn { [weak self, weak current] said in
        guard let self, let current, self.listening === current else { return }
        let text = said.trimmingCharacters(in: .whitespacesAndNewlines)
        OnDeviceLog.voice(text.isEmpty ? "Turn had no words" : "Turn: \(text)")
        if !text.isEmpty { current.onTurn(text) }
      }
    }
  }

  private static let levelLogInterval: TimeInterval = 1

  private static func logLevel(_ level: Double, threshold: Double, in current: Listening) {
    current.peak = max(current.peak, level)
    let now = ProcessInfo.processInfo.systemUptime
    guard now - current.loggedAt >= levelLogInterval else { return }
    OnDeviceLog.voice(String(format: "Level peak %.2f, voice threshold %.2f", current.peak, threshold))
    current.peak = 0
    current.loggedAt = now
  }
}

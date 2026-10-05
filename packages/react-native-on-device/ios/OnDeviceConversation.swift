import AVFoundation

// Apple audio and recognition are external dependencies; the controlled harness uses the
// same interface without opening a microphone or downloading recognition assets.
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

/// One open microphone and transcription, split into turns by acoustic pauses.
/// Lifecycle and callbacks belong to main; level detection belongs to the audio tap.
final class OnDeviceConversation {
  typealias Transcribe = (String, [String], @escaping (String) -> Void,
    @escaping (Error?) -> Void) throws -> any ConversationTranscription
  static let recognitionEnded = "Speech recognition ended"
  static let alreadyListening = "Speech recognition is already listening"

  private final class Listening {
    let levels = OnDeviceAudioLevel()
    let voice = OnDeviceVoiceActivity()
    var transcription: (any ConversationTranscription)?
    let onPartial: (String) -> Void
    let onTurn: (String) -> Void
    let onVoice: (Bool) -> Void
    let onStopped: (String) -> Void

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
    guard listening == nil else { throw OnDeviceError(message: Self.alreadyListening) }
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
        DispatchQueue.main.async {
          guard let self, let current, self.listening === current else { return }
          onLevel(level)
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
    cancel()
    current.onVoice(false)
    current.onStopped(reason)
  }

  private func voiceChanged(_ change: OnDeviceVoiceActivity.Change, in current: Listening) {
    switch change {
    case .started:
      current.onVoice(true)
    case .ended:
      current.onVoice(false)
      current.transcription?.endTurn { [weak self, weak current] said in
        guard let self, let current, self.listening === current else { return }
        let text = said.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { current.onTurn(text) }
      }
    }
  }
}

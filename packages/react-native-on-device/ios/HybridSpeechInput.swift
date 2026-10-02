import AVFoundation
import NitroModules
import Speech

final class HybridSpeechInput: HybridSpeechInputSpec {
  private static let recognitionEnded = "Speech recognition ended"

  // One transcription over one open microphone, split into turns where the speaker pauses.
  private final class Conversation {
    let onPartial: (String) -> Void
    let onTurn: (String) -> Void
    let onVoice: (Bool) -> Void
    let onStopped: (String) -> Void
    // Tap thread only.
    let levels = OnDeviceAudioLevel()
    let voice = OnDeviceVoiceActivity()
    var transcription: OnDeviceTranscription?

    init(onPartial: @escaping (String) -> Void, onTurn: @escaping (String) -> Void,
      onVoice: @escaping (Bool) -> Void, onStopped: @escaping (String) -> Void) {
      self.onPartial = onPartial
      self.onTurn = onTurn
      self.onVoice = onVoice
      self.onStopped = onStopped
    }

    func close() {
      transcription?.cancel()
      transcription = nil
    }
  }

  private var conversation: Conversation?

  func requestPermission() throws -> Promise<SpeechPermission> {
    let promise = Promise<SpeechPermission>()
    SFSpeechRecognizer.requestAuthorization { speech in
      AVAudioApplication.requestRecordPermission { microphone in
        let permission: SpeechPermission = speech == .restricted ? .restricted
          : (speech == .authorized && microphone ? .granted : .denied)
        promise.resolve(withResult: permission)
      }
    }
    return promise
  }

  func prepare(locale: String) throws -> Promise<SpeechInputAvailability> {
    let promise = Promise<SpeechInputAvailability>()
    Task {
      do {
        let ready = try await OnDeviceTranscription.prepare(locale: locale)
        promise.resolve(withResult: ready ? .available : .unavailable)
      } catch {
        OnDeviceLog.speechInput(error)
        promise.reject(withError: error)
      }
    }
    return promise
  }

  func listen(locale: String, hints: [String], onPartial: @escaping (String) -> Void,
    onTurn: @escaping (String) -> Void, onLevel: @escaping (Double) -> Void,
    onVoice: @escaping (Bool) -> Void, onStopped: @escaping (String) -> Void) throws
    -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [self] in
      var started: Conversation?
      do {
        try self.ensureIdle()
        let conversation = Conversation(onPartial: onPartial, onTurn: onTurn,
          onVoice: onVoice, onStopped: onStopped)
        started = conversation
        self.conversation = conversation
        let transcription = try OnDeviceTranscription(locale: locale, hints: hints,
          onChange: { [weak self, weak conversation] transcript in
            guard let self, let conversation, self.conversation === conversation else { return }
            conversation.onPartial(transcript)
          },
          onEnd: { [weak self, weak conversation] error in
            guard let self, let conversation, self.conversation === conversation else { return }
            if let error { OnDeviceLog.speechInput(error) }
            self.endConversation()
            conversation.onStopped(error?.localizedDescription ?? Self.recognitionEnded)
          })
        conversation.transcription = transcription
        _ = try OnDeviceAudioGraph.shared.startListening {
          [weak self, weak conversation, levels = conversation.levels,
            voice = conversation.voice] buffer, time in
          transcription.append(buffer)
          guard let level = levels.update(buffer, at: time.hostTime) else { return }
          onLevel(level)
          guard let change = voice.update(level, at: AVAudioTime.seconds(forHostTime: time.hostTime))
          else { return }
          DispatchQueue.main.async {
            guard let self, let conversation, self.conversation === conversation else { return }
            self.voiceChanged(change, in: conversation)
          }
        }
        promise.resolve()
      } catch {
        if let started, self.conversation === started { self.endConversation() }
        OnDeviceLog.speechInput(error)
        promise.reject(withError: error)
      }
    }
    return promise
  }

  func cancel() throws {
    DispatchQueue.main.async { self.endConversation() }
  }

  private func ensureIdle() throws {
    guard conversation == nil else {
      throw OnDeviceError(message: "Speech recognition is already listening")
    }
    guard SFSpeechRecognizer.authorizationStatus() == .authorized,
      AVAudioApplication.shared.recordPermission == .granted else {
      throw OnDeviceError(message: "Microphone and speech recognition permission required")
    }
  }

  // A turn ends where the voice stops, not where the words stop changing: the model sends
  // words in bursts, well after they are said, so waiting on them leaves the speaker waiting.
  private func voiceChanged(_ change: OnDeviceVoiceActivity.Change, in conversation: Conversation) {
    switch change {
    case .started:
      conversation.onVoice(true)
    case .ended:
      conversation.onVoice(false)
      conversation.transcription?.endTurn { [weak self, weak conversation] said in
        guard let self, let conversation, self.conversation === conversation else { return }
        let transcript = said.trimmingCharacters(in: .whitespacesAndNewlines)
        if !transcript.isEmpty { conversation.onTurn(transcript) }
      }
    }
  }

  private func endConversation() {
    guard let conversation else { return }
    self.conversation = nil
    conversation.close()
    OnDeviceAudioGraph.shared.stopListening()
  }
}

import AVFoundation
import NitroModules
import Speech

final class HybridSpeechInput: HybridSpeechInputSpec {
  // A pause this long after the last new word ends the turn.
  private static let turnPause: TimeInterval = 1.0
  private static let recognitionEnded = "Speech recognition ended"

  // One transcription over one open microphone, split into turns at pauses.
  private final class Conversation {
    let onPartial: (String) -> Void
    let onTurn: (String) -> Void
    let onStopped: (String) -> Void
    let levels = OnDeviceAudioLevel()
    var transcription: OnDeviceTranscription?
    var pause: DispatchWorkItem?

    init(onPartial: @escaping (String) -> Void, onTurn: @escaping (String) -> Void,
      onStopped: @escaping (String) -> Void) {
      self.onPartial = onPartial
      self.onTurn = onTurn
      self.onStopped = onStopped
    }

    func close() {
      pause?.cancel()
      pause = nil
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
    onStopped: @escaping (String) -> Void) throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [self] in
      var started: Conversation?
      do {
        try self.ensureIdle()
        let conversation = Conversation(onPartial: onPartial, onTurn: onTurn,
          onStopped: onStopped)
        started = conversation
        self.conversation = conversation
        let transcription = try OnDeviceTranscription(locale: locale, hints: hints,
          onChange: { [weak self, weak conversation] transcript in
            guard let self, let conversation, self.conversation === conversation else { return }
            conversation.onPartial(transcript)
            self.awaitPause(conversation)
          },
          onEnd: { [weak self, weak conversation] error in
            guard let self, let conversation, self.conversation === conversation else { return }
            if let error { OnDeviceLog.speechInput(error) }
            self.endConversation()
            conversation.onStopped(error?.localizedDescription ?? Self.recognitionEnded)
          })
        conversation.transcription = transcription
        _ = try OnDeviceAudioGraph.shared.startListening {
          [levels = conversation.levels] buffer, time in
          transcription.append(buffer)
          if let level = levels.update(buffer, at: time.hostTime) { onLevel(level) }
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

  private func awaitPause(_ conversation: Conversation) {
    conversation.pause?.cancel()
    let pause = DispatchWorkItem { [weak self, weak conversation] in
      guard let self, let conversation else { return }
      self.endTurn(conversation)
    }
    conversation.pause = pause
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.turnPause, execute: pause)
  }

  private func endTurn(_ conversation: Conversation) {
    guard self.conversation === conversation, let transcription = conversation.transcription
    else { return }
    conversation.pause = nil
    let transcript = transcription.text.trimmingCharacters(in: .whitespacesAndNewlines)
    transcription.startTurn()
    if !transcript.isEmpty { conversation.onTurn(transcript) }
  }

  private func endConversation() {
    guard let conversation else { return }
    self.conversation = nil
    conversation.close()
    OnDeviceAudioGraph.shared.stopListening()
  }
}

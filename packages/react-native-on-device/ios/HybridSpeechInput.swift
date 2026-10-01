import AVFoundation
import NitroModules
import Speech

final class HybridSpeechInput: HybridSpeechInputSpec {
  private static let inputBus: AVAudioNodeBus = 0
  private static let audioBufferSize: AVAudioFrameCount = 1024
  private static let finalResultTimeout: TimeInterval = 5
  // Hands free: a pause this long after the last new word ends the turn.
  private static let turnPause: TimeInterval = 1.0
  private static let recognitionEnded = "Speech recognition ended"

  private final class Recording {
    let engine = AVAudioEngine()
    let levels = OnDeviceAudioLevel()
    var transcription: OnDeviceTranscription?
    var tapInstalled = false
    var outcome: Result<String, Error>?
    var completion: Promise<String>?
    var timeout: DispatchWorkItem?

    func stopAudio() {
      engine.stop()
      if tapInstalled {
        engine.inputNode.removeTap(onBus: HybridSpeechInput.inputBus)
        tapInstalled = false
      }
    }

    deinit {
      timeout?.cancel()
      stopAudio()
      transcription?.cancel()
      if let completion {
        let error = OnDeviceError(message: "Speech recognition cancelled")
        OnDeviceLog.speechInput(error)
        completion.reject(withError: error)
      }
    }
  }

  // Hands free: one transcription over one open microphone, split into turns at pauses.
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

  private var recording: Recording?
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

  func start(locale: String, hints: [String], onPartial: @escaping (String) -> Void,
    onLevel: @escaping (Double) -> Void)
    throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [self] in
      var started: Recording?
      do {
        try self.ensureIdle()
        try OnDeviceAudioSession.activate()
        let recording = Recording()
        started = recording
        self.recording = recording
        let transcription = try OnDeviceTranscription(locale: locale, hints: hints,
          onChange: { [weak self, weak recording] transcript in
            guard let self, let recording, self.recording === recording,
              recording.outcome == nil else { return }
            onPartial(transcript)
          },
          onEnd: { [weak self, weak recording] error in
            guard let self, let recording, self.recording === recording,
              recording.outcome == nil else { return }
            if let error { OnDeviceLog.speechInput(error) }
            recording.outcome = error.map { .failure($0) }
              ?? .success(recording.transcription?.text ?? "")
            recording.stopAudio()
            self.complete(recording)
          })
        recording.transcription = transcription
        let input = recording.engine.inputNode
        let format = input.outputFormat(forBus: Self.inputBus)
        guard format.sampleRate > 0, format.channelCount > 0 else {
          throw OnDeviceError(message: "Microphone audio format unavailable")
        }
        input.installTap(onBus: Self.inputBus, bufferSize: Self.audioBufferSize, format: format) {
          [levels = recording.levels] buffer, time in
          transcription.append(buffer)
          if let level = levels.update(buffer, at: time.hostTime) { onLevel(level) }
        }
        recording.tapInstalled = true
        recording.engine.prepare()
        try recording.engine.start()
        promise.resolve()
      } catch {
        if let started, self.recording === started { self.recording = nil }
        OnDeviceLog.speechInput(error)
        promise.reject(withError: error)
      }
    }
    return promise
  }

  func finish() throws -> Promise<String> {
    let promise = Promise<String>()
    DispatchQueue.main.async { [self] in
      guard let recording = self.recording else {
        promise.resolve(withResult: "")
        return
      }
      guard recording.completion == nil else {
        let error = OnDeviceError(message: "Speech recognition is already finishing")
        OnDeviceLog.speechInput(error)
        promise.reject(withError: error)
        return
      }
      recording.completion = promise
      recording.stopAudio()
      recording.transcription?.finish()
      if recording.outcome != nil {
        self.complete(recording)
        return
      }
      let timeout = DispatchWorkItem { [weak self, weak recording] in
        guard let self, let recording, self.recording === recording else { return }
        recording.outcome = .success(recording.transcription?.text ?? "")
        self.complete(recording)
      }
      recording.timeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.finalResultTimeout, execute: timeout)
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
    DispatchQueue.main.async {
      self.recording = nil
      self.endConversation()
    }
  }

  private func ensureIdle() throws {
    guard recording == nil, conversation == nil else {
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

  private func complete(_ recording: Recording) {
    guard let promise = recording.completion, let outcome = recording.outcome else { return }
    recording.completion = nil
    self.recording = nil
    let heard = recording.transcription?.text ?? ""
    switch outcome {
    case .success(let transcript): promise.resolve(withResult: transcript)
    case .failure(let error):
      if heard.isEmpty {
        promise.reject(withError: error)
      } else {
        promise.resolve(withResult: heard)
      }
    }
  }
}

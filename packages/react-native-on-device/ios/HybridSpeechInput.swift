import AVFoundation
import NitroModules
import Speech

final class HybridSpeechInput: HybridSpeechInputSpec {
  private static let inputBus: AVAudioNodeBus = 0
  private static let audioBufferSize: AVAudioFrameCount = 1024
  private static let finalResultTimeout: TimeInterval = 5
  private static let noSpeechErrorCode = 1110

  private final class Recording {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    let levels = OnDeviceAudioLevel()
    var task: SFSpeechRecognitionTask?
    var tapInstalled = false
    var transcript = ""
    var outcome: Result<String, Error>?
    var completion: Promise<String>?
    var timeout: DispatchWorkItem?
    let onPartial: (String) -> Void

    init(onPartial: @escaping (String) -> Void) { self.onPartial = onPartial }

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
      request.endAudio()
      task?.cancel()
      if let completion {
        let error = OnDeviceError(message: "Speech recognition cancelled")
        OnDeviceLog.speechInput(error)
        completion.reject(withError: error)
      }
    }
  }

  private var recording: Recording?

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

  func availability(locale: String) throws -> SpeechInputAvailability {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
      recognizer.isAvailable else { return .unavailable }
    return recognizer.supportsOnDeviceRecognition ? .available : .ondeviceunsupported
  }

  func start(locale: String, hints: [String], onPartial: @escaping (String) -> Void,
    onLevel: @escaping (Double) -> Void)
    throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [self] in
      var started: Recording?
      do {
        guard self.recording == nil else {
          throw OnDeviceError(message: "Speech recognition is already listening")
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
          AVAudioApplication.shared.recordPermission == .granted else {
          throw OnDeviceError(message: "Microphone and speech recognition permission required")
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
          recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
          throw OnDeviceError(message: "On-device speech recognition unavailable for \(locale)")
        }
        try OnDeviceAudioSession.activate()
        let recording = Recording(onPartial: onPartial)
        recording.request.requiresOnDeviceRecognition = true
        recording.request.contextualStrings = hints
        recording.request.shouldReportPartialResults = true
        recording.request.addsPunctuation = true
        started = recording
        self.recording = recording
        recording.task = recognizer.recognitionTask(with: recording.request) {
          [weak self, weak recording] result, error in
          DispatchQueue.main.async {
            guard let self, let recording, self.recording === recording,
              recording.outcome == nil else { return }
            if let result {
              let transcript = result.bestTranscription.formattedString
              if transcript != recording.transcript {
                recording.transcript = transcript
                recording.onPartial(transcript)
              }
              if result.isFinal { recording.outcome = .success(transcript) }
            }
            if recording.outcome == nil, let error {
              let nativeError = error as NSError
              recording.outcome = nativeError.domain == "kAFAssistantErrorDomain"
                && nativeError.code == Self.noSpeechErrorCode
                ? .success(recording.transcript) : .failure(error)
              if case .failure = recording.outcome { OnDeviceLog.speechInput(error) }
            }
            if recording.outcome != nil {
              recording.stopAudio()
              self.complete(recording)
            }
          }
        }
        let input = recording.engine.inputNode
        let format = input.outputFormat(forBus: Self.inputBus)
        guard format.sampleRate > 0, format.channelCount > 0 else {
          throw OnDeviceError(message: "Microphone audio format unavailable")
        }
        input.installTap(onBus: HybridSpeechInput.inputBus, bufferSize: Self.audioBufferSize, format: format) {
          [request = recording.request, levels = recording.levels] buffer, time in
          request.append(buffer)
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
      recording.request.endAudio()
      if recording.outcome != nil {
        self.complete(recording)
        return
      }
      let timeout = DispatchWorkItem { [weak self, weak recording] in
        guard let self, let recording, self.recording === recording else { return }
        recording.outcome = .success(recording.transcript)
        self.complete(recording)
      }
      recording.timeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.finalResultTimeout, execute: timeout)
    }
    return promise
  }

  func cancel() throws {
    DispatchQueue.main.async { self.recording = nil }
  }

  private func complete(_ recording: Recording) {
    guard let promise = recording.completion, let outcome = recording.outcome else { return }
    recording.completion = nil
    self.recording = nil
    switch outcome {
    case .success(let transcript): promise.resolve(withResult: transcript)
    case .failure(let error):
      if recording.transcript.isEmpty {
        promise.reject(withError: error)
      } else {
        promise.resolve(withResult: recording.transcript)
      }
    }
  }
}

import AVFoundation
import NitroModules
import Speech

final class HybridSpeechInput: HybridSpeechInputSpec {
  private let conversation = OnDeviceConversation(audio: OnDeviceAudioGraph.shared) {
    locale, hints, onChange, onEnd in
    try OnDeviceTranscription(locale: locale, hints: hints, onChange: onChange, onEnd: onEnd)
  }

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
      do {
        try self.ensurePermission()
        guard !OnDeviceAudioGraph.shared.listening else {
          throw OnDeviceError(message: OnDeviceError.alreadyListening)
        }
        try self.conversation.listen(locale: locale, hints: hints, onPartial: onPartial,
          onTurn: onTurn, onLevel: onLevel, onVoice: onVoice, onStopped: onStopped)
        promise.resolve()
      } catch {
        OnDeviceLog.speechInput(error)
        promise.reject(withError: error)
      }
    }
    return promise
  }

  func cancel() throws {
    DispatchQueue.main.async { self.conversation.cancel() }
  }

  private func ensurePermission() throws {
    guard SFSpeechRecognizer.authorizationStatus() == .authorized,
      AVAudioApplication.shared.recordPermission == .granted else {
      throw OnDeviceError(message: "Microphone and speech recognition permission required")
    }
  }

}

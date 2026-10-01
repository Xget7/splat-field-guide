import AVFoundation
import NitroModules

final class HybridSpeechOutput: HybridSpeechOutputSpec {
  private static let speechVolume: Float = 1
  private final class Delegate: NSObject, AVSpeechSynthesizerDelegate {
    weak var owner: HybridSpeechOutput?
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
      didFinish utterance: AVSpeechUtterance) { owner?.complete(utterance) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
      didCancel utterance: AVSpeechUtterance) { owner?.complete(utterance) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
      willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
      owner?.reportWord(characterRange, utterance: utterance)
    }
  }

  private struct PendingSpeech {
    let promise: Promise<Void>
    let onWord: (Double, Double) -> Void
  }

  private lazy var delegate: Delegate = {
    let delegate = Delegate()
    delegate.owner = self
    return delegate
  }()
  private lazy var synthesizer: AVSpeechSynthesizer = {
    let synthesizer = AVSpeechSynthesizer()
    synthesizer.delegate = delegate
    return synthesizer
  }()
  private var pending: [ObjectIdentifier: PendingSpeech] = [:]

  func speak(text: String, locale: String, onWord: @escaping (Double, Double) -> Void)
    throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async {
      self.stopCurrent()
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        promise.resolve()
        return
      }
      do {
        try OnDeviceAudioSession.activate()
        let utterance = AVSpeechUtterance(string: text)
        guard let voice = Self.bestVoice(locale: locale) else {
          throw OnDeviceError(message: "No installed speech voice for \(locale)")
        }
        utterance.voice = voice
        utterance.volume = Self.speechVolume
        self.pending[ObjectIdentifier(utterance)] = PendingSpeech(promise: promise, onWord: onWord)
        self.synthesizer.speak(utterance)
      } catch { promise.reject(withError: error) }
    }
    return promise
  }

  func stop() throws {
    DispatchQueue.main.async { self.stopCurrent() }
  }

  private func stopCurrent() {
    let speeches = Array(pending.values)
    pending.removeAll()
    synthesizer.stopSpeaking(at: .immediate)
    speeches.forEach { $0.promise.resolve() }
  }

  private func complete(_ utterance: AVSpeechUtterance) {
    DispatchQueue.main.async {
      self.pending.removeValue(forKey: ObjectIdentifier(utterance))?.promise.resolve()
    }
  }

  private func reportWord(_ range: NSRange, utterance: AVSpeechUtterance) {
    DispatchQueue.main.async {
      self.pending[ObjectIdentifier(utterance)]?.onWord(Double(range.location), Double(range.length))
    }
  }

  private static func bestVoice(locale: String) -> AVSpeechSynthesisVoice? {
    let language = locale.replacingOccurrences(of: "_", with: "-").lowercased()
    let base = language.split(separator: "-").first
    let voices = AVSpeechSynthesisVoice.speechVoices().filter {
      !$0.voiceTraits.contains(.isNoveltyVoice) && !$0.voiceTraits.contains(.isPersonalVoice)
    }
    let exact = voices.filter { $0.language.lowercased() == language }
    let candidates = exact.isEmpty
      ? voices.filter { $0.language.lowercased().split(separator: "-").first == base } : exact
    let preferred = candidates.filter { $0.quality == .premium || $0.quality == .enhanced }.sorted {
      if $0.quality != $1.quality { return $0.quality.rawValue > $1.quality.rawValue }
      return $0.identifier < $1.identifier
    }.first
    if let preferred { return preferred }
    guard let voice = AVSpeechSynthesisVoice(language: locale.replacingOccurrences(of: "_", with: "-")),
      !voice.voiceTraits.contains(.isNoveltyVoice),
      !voice.voiceTraits.contains(.isPersonalVoice) else { return nil }
    return voice
  }

  deinit { pending.values.forEach { $0.promise.resolve() } }
}

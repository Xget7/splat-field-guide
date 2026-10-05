import AVFoundation
import NitroModules

final class HybridSpeechOutput: HybridSpeechOutputSpec {
  private final class Utterance {
    let text: String
    let locale: String
    let sentences: [SpeechSentence]
    let promise: Promise<Void>
    let onWord: (Double, Double) -> Void
    let cancellation = KokoroCancellation()
    let requestedAt = ProcessInfo.processInfo.systemUptime
    var ready: [Int: AVAudioPCMBuffer] = [:]
    var current = 0
    var next = 0
    var synthesizing = false
    var playing = false
    var firstAudioReported = false
    var fallbackAt: Int?
    var systemUtterance: AVSpeechUtterance?
    var systemOffset = 0

    init(text: String, locale: String, promise: Promise<Void>, onWord: @escaping (Double, Double) -> Void) {
      self.text = text
      self.locale = locale
      self.promise = promise
      self.onWord = onWord
      sentences = SpeechTextPlan.sentences(in: text)
    }
  }

  private final class Delegate: NSObject, AVSpeechSynthesizerDelegate {
    weak var owner: HybridSpeechOutput?
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
      owner?.completeSystem(utterance)
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
      owner?.completeSystem(utterance)
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer,
      willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
      DispatchQueue.main.async { [weak self] in
        guard let current = self?.owner?.active, current.systemUtterance === utterance else { return }
        current.onWord(Double(current.systemOffset + range.location), Double(range.length))
      }
    }
  }

  // Model state belongs exclusively to this worker. Playback and utterance state belong to main.
  private let worker = DispatchQueue(label: "dev.splatfieldguide.kokoro", qos: .userInitiated)
  private var model: Result<KokoroEngine, Error>?
  private var active: Utterance?
  private let graph = OnDeviceAudioGraph.shared
  private var wordTimer: DispatchSourceTimer?
  private var observers: [NSObjectProtocol] = []
  private lazy var delegate: Delegate = {
    let value = Delegate()
    value.owner = self
    return value
  }()
  private lazy var synthesizer: AVSpeechSynthesizer = {
    let value = AVSpeechSynthesizer()
    value.delegate = delegate
    return value
  }()

  override init() {
    super.init()
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: OnDeviceAudioGraph.didInterruptPlayback, object: graph,
        queue: .main) { [weak self] _ in self?.stopCurrent() },
    ]
    // The JS factory is lazy. Merely creating output on entering the instructor warms off UI.
    worker.async {
      let start = ProcessInfo.processInfo.systemUptime
      let result = Result { try KokoroEngine() }
      self.model = result
      switch result {
      case .success(let engine):
        do { _ = try engine.synthesize("Ready.", cancellation: KokoroCancellation()) }
        catch { OnDeviceLog.speechOutput("Kokoro warmup failed: \(error.localizedDescription)") }
        OnDeviceLog.speechMeasurement(String(format: "model_warm_ms=%.1f",
          (ProcessInfo.processInfo.systemUptime - start) * 1000))
      case .failure(let error):
        OnDeviceLog.speechOutput("Kokoro unavailable, using Apple speech: \(error.localizedDescription)")
      }
    }
#if DEBUG
    if ProcessInfo.processInfo.arguments.contains("-kokoro-benchmark") {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.runBenchmark(0) }
    }
#endif
  }

  func speak(text: String, locale: String, onWord: @escaping (Double, Double) -> Void) throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async {
      self.stopCurrent()
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        promise.resolve()
        return
      }
      let utterance = Utterance(text: text, locale: locale, promise: promise, onWord: onWord)
      self.active = utterance
      if locale.replacingOccurrences(of: "_", with: "-").lowercased().split(separator: "-").first != "en" {
        OnDeviceLog.speechOutput("Kokoro English voice does not support \(locale); using Apple speech")
        self.fallback(utterance, at: 0)
      } else {
        self.synthesizeNext(utterance)
      }
    }
    return promise
  }

  func stop() throws { DispatchQueue.main.async { self.stopCurrent() } }

  private func stopCurrent() {
    let previous = active
    active = nil
    previous?.cancellation.cancel()
    wordTimer?.cancel()
    wordTimer = nil
    graph.stopPlayback()
    if previous?.systemUtterance != nil { synthesizer.stopSpeaking(at: .immediate) }
    previous?.promise.resolve()
  }

  // At most the playing sentence and one following sentence are retained or being synthesized.
  private func synthesizeNext(_ utterance: Utterance) {
    guard active === utterance, !utterance.synthesizing, utterance.fallbackAt == nil,
      utterance.next < utterance.sentences.count, utterance.next <= utterance.current + 1 else { return }
    let index = utterance.next
    utterance.next += 1
    utterance.synthesizing = true
    worker.async {
      guard !utterance.cancellation.isCancelled else { return }
      let start = ProcessInfo.processInfo.systemUptime
      let result = Result { () throws -> AVAudioPCMBuffer in
        guard let model = self.model else { throw OnDeviceError(message: "Kokoro is not initialized") }
        return try model.get().synthesize(utterance.sentences[index].text, cancellation: utterance.cancellation)
      }
      let elapsed = ProcessInfo.processInfo.systemUptime - start
      DispatchQueue.main.async {
        guard self.active === utterance else { return }
        utterance.synthesizing = false
        switch result {
        case .success(let buffer):
          let duration = Double(buffer.frameLength) / KokoroEngine.sampleRate
          OnDeviceLog.speechMeasurement(String(format: "sentence=%d synth_ms=%.1f audio_s=%.3f rtf=%.3f",
            index + 1, elapsed * 1000, duration, elapsed / duration))
          utterance.ready[index] = buffer
          self.playIfReady(utterance)
          self.synthesizeNext(utterance)
        case .failure(let error):
          OnDeviceLog.speechOutput("Kokoro synthesis failed at sentence \(index + 1); using Apple speech: \(error.localizedDescription)")
          utterance.fallbackAt = index
          if !utterance.playing { self.fallback(utterance, at: utterance.current) }
        }
      }
    }
  }

  private func playIfReady(_ utterance: Utterance) {
    guard active === utterance, !utterance.playing,
      let buffer = utterance.ready.removeValue(forKey: utterance.current) else { return }
    do {
      try graph.startPlayback()
      let engine = graph.engine
      let node = graph.player
      let index = utterance.current
      // A new playback timeline makes the sentence's sample offset independent of earlier pauses.
      node.stop()
      node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
        DispatchQueue.main.async {
          guard let self, self.active === utterance,
            utterance.current == index, utterance.playing else { return }
          self.wordTimer?.cancel()
          self.wordTimer = nil
          utterance.playing = false
          utterance.current = index + 1
          if utterance.current == utterance.sentences.count {
            self.finish(utterance)
          } else if utterance.fallbackAt != nil {
            self.fallback(utterance, at: utterance.current)
          } else {
            self.playIfReady(utterance)
            self.synthesizeNext(utterance)
          }
        }
      }
      utterance.playing = true
      node.play()
      trackWords(utterance, sentence: utterance.sentences[index], buffer: buffer, node: node, engine: engine)
    } catch {
      OnDeviceLog.speechOutput("Kokoro playback failed; using Apple speech: \(error.localizedDescription)")
      fallback(utterance, at: utterance.current)
    }
  }

  private func trackWords(_ utterance: Utterance, sentence: SpeechSentence,
    buffer: AVAudioPCMBuffer, node: AVAudioPlayerNode, engine: AVAudioEngine) {
    wordTimer?.cancel()
    let duration = Double(buffer.frameLength) / KokoroEngine.sampleRate
    let weight = max(1, sentence.words.reduce(0) { $0 + $1.length })
    var consumed = 0
    let starts = sentence.words.map { range -> Double in
      defer { consumed += range.length }
      return duration * Double(consumed) / Double(weight)
    }
    var nextWord = 0
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now(), repeating: .milliseconds(15))
    timer.setEventHandler { [weak self, weak node, weak engine] in
      guard let self, self.active === utterance, let node, let engine,
        let render = node.lastRenderTime, let time = node.playerTime(forNodeTime: render) else { return }
      // Sample position follows rendering, not a wall-clock timer that drifts across queue gaps.
      let heard = Double(time.sampleTime) / time.sampleRate - engine.outputNode.presentationLatency
      guard heard >= 0 else { return }
      if !utterance.firstAudioReported {
        utterance.firstAudioReported = true
        OnDeviceLog.speechMeasurement(String(format: "first_audio_ms=%.1f",
          (ProcessInfo.processInfo.systemUptime - utterance.requestedAt) * 1000))
      }
      while nextWord < starts.count, starts[nextWord] <= heard {
        let range = sentence.words[nextWord]
        utterance.onWord(Double(range.location), Double(range.length))
        nextWord += 1
      }
    }
    wordTimer = timer
    timer.resume()
  }

  private func fallback(_ utterance: Utterance, at index: Int) {
    guard active === utterance else { return }
    utterance.cancellation.cancel()
    utterance.ready.removeAll()
    wordTimer?.cancel()
    wordTimer = nil
    graph.stopPlayback()
    do {
      try OnDeviceAudioSession.activate()
      let offset = index < utterance.sentences.count ? utterance.sentences[index].range.location : 0
      let remaining = (utterance.text as NSString).substring(from: offset)
      let system = AVSpeechUtterance(string: remaining)
      guard let voice = Self.bestVoice(locale: utterance.locale) else {
        throw OnDeviceError(message: "No installed speech voice for \(utterance.locale)")
      }
      system.voice = voice
      system.volume = 1
      utterance.systemOffset = offset
      utterance.systemUtterance = system
      synthesizer.speak(system)
    } catch { finish(utterance, error: error) }
  }

  private func completeSystem(_ system: AVSpeechUtterance) {
    DispatchQueue.main.async {
      guard let current = self.active, current.systemUtterance === system else { return }
      self.finish(current)
    }
  }

  private func finish(_ utterance: Utterance, error: Error? = nil) {
    guard active === utterance else { return }
    active = nil
    utterance.cancellation.cancel()
    wordTimer?.cancel()
    wordTimer = nil
    graph.stopPlayback()
    // Keep playAndRecord active. Speech input will reuse the shared session immediately.
    if let error { utterance.promise.reject(withError: error) } else { utterance.promise.resolve() }
  }

#if DEBUG
  private func runBenchmark(_ index: Int) {
    let samples = [
      "Before checking the coolant level, let the engine cool completely and park on level ground.",
      "The brake fluid reservoir sits near the back of the engine bay beside the battery.",
      "Look for the power steering reservoir, then check its fluid level between the marked lines.",
    ]
    guard index < samples.count else {
      OnDeviceLog.speechMeasurement("benchmark_complete")
      return
    }
    OnDeviceLog.speechMeasurement("benchmark_sample=\(index + 1) text=\(samples[index])")
    do {
      try speak(text: samples[index], locale: "en-US", onWord: { _, _ in })
        .then { [weak self] in self?.runBenchmark(index + 1) }
        .catch { OnDeviceLog.speechOutput("Benchmark failed: \($0.localizedDescription)") }
    } catch { OnDeviceLog.speechOutput("Benchmark failed: \(error.localizedDescription)") }
  }
#endif
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

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    active?.cancellation.cancel()
    wordTimer?.cancel()
    active?.promise.resolve()
  }
}

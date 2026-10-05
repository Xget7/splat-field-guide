import AVFoundation
import Speech

private protocol TranscriptionResult: SpeechModuleResult, Sendable {
  var text: AttributedString { get }
}

extension SpeechTranscriber.Result: TranscriptionResult {}
extension DictationTranscriber.Result: TranscriptionResult {}

/// Live transcription with SpeechAnalyzer, the on-device model behind Notes and Voice Memos,
/// which hears accented speech far better than SFSpeechRecognizer. Audio comes in on the
/// microphone's tap thread; everything else, callbacks included, is on the main queue.
final class OnDeviceTranscription: ConversationTranscription, @unchecked Sendable {
  private struct Model {
    let locale: Locale
    let format: AVAudioFormat
    // SpeechTranscriber where the device has it, else the older dictation model.
    let full: Bool
  }

  private static let modelsLock = NSLock()
  private static var models: [String: Model] = [:]

  /// Finds the model for a locale and installs it, downloading it once if needed, so later
  /// transcription works offline. False when the locale cannot be transcribed here.
  static func prepare(locale identifier: String) async throws -> Bool {
    if modelsLock.withLock({ models[identifier] }) != nil { return true }
    let requested = Locale(identifier: identifier)
    let full = SpeechTranscriber.isAvailable
    let found = full ? await SpeechTranscriber.supportedLocale(equivalentTo: requested)
      : await DictationTranscriber.supportedLocale(equivalentTo: requested)
    guard let locale = found else { return false }
    let module: any SpeechModule = full ? transcriber(locale) : dictation(locale)
    let modules: [any SpeechModule] = [module, detector()]
    if let request = try await AssetInventory.assetInstallationRequest(supporting: modules) {
      try await request.downloadAndInstall()
    }
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules)
    else { return false }
    modelsLock.withLock { models[identifier] = Model(locale: locale, format: format, full: full) }
    return true
  }

  private static func transcriber(_ locale: Locale) -> SpeechTranscriber {
    SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults],
      attributeOptions: [])
  }

  /// Apple's voice activity detection: audio with no speech in it is not transcribed, so room
  /// noise does not come back as a stray "." or word. Medium is Apple's recommended level.
  private static func detector() -> SpeechDetector {
    SpeechDetector(detectionOptions: .init(sensitivityLevel: .medium), reportResults: false)
  }

  private static func dictation(_ locale: Locale) -> DictationTranscriber {
    DictationTranscriber(locale: locale, contentHints: [.shortForm],
      transcriptionOptions: [.punctuation], reportingOptions: [.volatileResults],
      attributeOptions: [])
  }

  private let analyzer: SpeechAnalyzer
  private let format: AVAudioFormat
  private let input: AsyncStream<AnalyzerInput>.Continuation
  private let onChange: (String) -> Void
  private let onEnd: (Error?) -> Void
  private var reading: Task<Void, Never>?
  private var closed = false
  // How long to wait for results already sent once the model has finalised, and for the
  // model itself should it not answer.
  private static let settleGrace: TimeInterval = 0.15
  private static let longestSettle: TimeInterval = 1.5

  // Results from audio before this time belong to an earlier turn.
  private var since = CMTime.zero
  // The turn being finalised: where it ends, and who gets its text.
  private var ending: (through: CMTime, done: (String) -> Void)?
  // Settled words heard after the turn being finalised, which start the next one.
  private var next: [String] = []
  private var finalized: [String] = []
  private var volatile = ""
  /// Everything heard since the start or the last turn ended.
  private(set) var text = ""

  // Tap thread only.
  private var converter: AVAudioConverter?
  // Counted on the tap thread, read on main.
  private let fedLock = NSLock()
  private var fedFrames: AVAudioFramePosition = 0

  /// Starts at once and buffers audio while the model loads, so no word is lost. `prepare` must
  /// have succeeded for the locale. `onChange` gets the whole text each time it changes and
  /// `onEnd` the error, if any, if results stop before `cancel`.
  init(locale identifier: String, hints: [String], onChange: @escaping (String) -> Void,
    onEnd: @escaping (Error?) -> Void) throws {
    guard let model = Self.modelsLock.withLock({ Self.models[identifier] }) else {
      throw OnDeviceError(message: "Speech recognition is not ready for \(identifier)")
    }
    format = model.format
    self.onChange = onChange
    self.onEnd = onEnd
    let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
    self.input = input
    let context = AnalysisContext()
    context.contextualStrings[.general] = hints
    let options = SpeechAnalyzer.Options(priority: .userInitiated, modelRetention: .processLifetime)
    if model.full {
      let module = Self.transcriber(model.locale)
      analyzer = SpeechAnalyzer(inputSequence: stream, modules: [module, Self.detector()],
        options: options, analysisContext: context)
      reading = read(module.results)
    } else {
      let module = Self.dictation(model.locale)
      analyzer = SpeechAnalyzer(inputSequence: stream, modules: [module, Self.detector()],
        options: options, analysisContext: context)
      reading = read(module.results)
    }
  }

  /// Tap thread: converts microphone audio to the model's format and queues it.
  func append(_ buffer: AVAudioPCMBuffer) {
    guard let converted = convert(buffer) else { return }
    fedLock.withLock { fedFrames += AVAudioFramePosition(converted.frameLength) }
    input.yield(AnalyzerInput(buffer: converted))
  }

  /// Ends the turn at the audio heard so far and hands over its text once the model has
  /// settled it. The model on its own holds its last words back for more context, seconds after
  /// the speaker has stopped; asked to finalise, it gives them in a fraction of a second. Audio
  /// after this point starts the next turn.
  func endTurn(_ done: @escaping (String) -> Void) {
    guard ending == nil else { return }
    let through = CMTime(value: fedLock.withLock { fedFrames },
      timescale: CMTimeScale(format.sampleRate))
    ending = (through, done)
    Task { [weak self, analyzer] in
      try? await analyzer.finalize(through: through)
      // Results the model sent just before returning are still on their way to main.
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.settleGrace) {
        self?.settle(through)
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.longestSettle) { [weak self] in
      self?.settle(through)
    }
  }

  /// Stops at once; no callback follows.
  func cancel() {
    closed = true
    input.finish()
    reading?.cancel()
    Task { [analyzer] in await analyzer.cancelAndFinishNow() }
  }

  private func read<Results: AsyncSequence & Sendable>(_ results: Results) -> Task<Void, Never>
    where Results.Element: TranscriptionResult {
    Task { [weak self] in
      var failure: Error?
      do {
        for try await result in results {
          let piece = String(result.text.characters)
          let range = result.range
          let isFinal = result.isFinal
          let settled = result.resultsFinalizationTime
          DispatchQueue.main.async {
            self?.take(piece, range: range, isFinal: isFinal, settled: settled)
          }
        }
      } catch {
        failure = error
      }
      DispatchQueue.main.async {
        guard let self, !self.closed else { return }
        self.closed = true
        self.onEnd(failure)
      }
    }
  }

  private func take(_ piece: String, range: CMTimeRange, isFinal: Bool, settled: CMTime) {
    guard !closed, CMTimeCompare(range.start, since) >= 0 else { return }
    if let ending, CMTimeCompare(range.start, ending.through) >= 0 {
      // The next turn has begun; its passing guesses come again once this one is done.
      if isFinal { next.append(piece) }
      return
    }
    if isFinal {
      finalized.append(piece)
      volatile = ""
    } else {
      volatile = piece
    }
    publish()
    if let ending, isFinal, CMTimeCompare(settled, ending.through) >= 0 { settle(ending.through) }
  }

  private func publish() {
    let joined = (finalized + [volatile])
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    guard joined != text else { return }
    text = joined
    onChange(joined)
  }

  private func settle(_ through: CMTime) {
    guard !closed, let ending, ending.through == through else { return }
    let said = text
    self.ending = nil
    since = through
    finalized = next
    next = []
    volatile = ""
    text = ""
    ending.done(said)
    if !finalized.isEmpty { publish() }
  }

  private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    if converter?.inputFormat != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: format)
    }
    guard let converter else { return nil }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
      return nil
    }
    var supplied = false
    var error: NSError?
    // Leftover samples stay in the converter for the next buffer.
    let status = converter.convert(to: output, error: &error) { _, inputStatus in
      if supplied {
        inputStatus.pointee = .noDataNow
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return buffer
    }
    guard status != .error, output.frameLength > 0 else { return nil }
    return output
  }
}

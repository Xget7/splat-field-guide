import AVFoundation
import NitroModules

final class HybridAudioLink: HybridAudioLinkSpec {
  // Each tap owns its converter and partial chunk on the audio thread.
  private final class Input {
    let format: AVAudioFormat
    let levels = OnDeviceAudioLevel()
    var converter: AVAudioConverter?
    var chunks: AudioLinkPCM.Chunks

    init(rate: Double) throws {
      guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16,
        sampleRate: rate, channels: HybridAudioLink.channelCount, interleaved: false) else {
        throw OnDeviceError(message: HybridAudioLink.invalidRate)
      }
      self.format = format
      chunks = AudioLinkPCM.Chunks(sampleRate: Int(rate))
    }

    func convert(_ buffer: AVAudioPCMBuffer) throws -> [Data] {
      if converter == nil { converter = AVAudioConverter(from: buffer.format, to: format) }
      guard let converter else { throw OnDeviceError(message: HybridAudioLink.conversionFailed) }
      let output = try HybridAudioLink.convert(buffer, with: converter, to: format)
      guard let samples = output.int16ChannelData else {
        throw OnDeviceError(message: HybridAudioLink.conversionFailed)
      }
      // Int16 channel data uses host byte order, while the bridge always uses little endian.
      let floats = (0..<Int(output.frameLength)).map { Float(samples[0][$0]) / AudioLinkPCM.scale }
      return try chunks.append(AudioLinkPCM.bytes(from: floats))
    }
  }

  private struct Session {
    var linked = false
    var generation = 0
    var onStopped: ((String) -> Void)?
    var observer: NSObjectProtocol?
  }

  private let graph = OnDeviceAudioGraph.shared
  private var session = Session()
  private var outputRate = OnDeviceAudioGraph.speechSampleRate
  private var outputConverter: AVAudioConverter?
  private var playback = AudioLinkPCM.Playback()
  private let playbackLock = NSLock()
  private var playedMilliseconds = 0.0
  private var playbackTimer: DispatchSourceTimer?
  private static let channelCount: AVAudioChannelCount = 1
  private static let playbackInterval = DispatchTimeInterval.milliseconds(16)
  private static let millisecondsPerSecond = 1000.0
  private static let minimumRate = 8_000.0
  private static let maximumRate = 192_000.0
  private static let conversionHeadroom: AVAudioFrameCount = 256
  private static let invalidRate = "Audio link requires supported whole sample rates and 100 ms input chunks"
  private static let permissionRequired = "Microphone permission required for audio link"
  private static let conversionFailed = "Audio link PCM conversion failed"
  private static let invalidChunk = "Audio link requires base64 little-endian PCM16"
  private static let interrupted = "Audio session interrupted"

  func start(inputRate: Double, outputRate: Double, onInput: @escaping (String) -> Void,
    onLevel: @escaping (Double) -> Void, onStopped: @escaping (String) -> Void) throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [self] in
      var opening = false
      do {
        guard !self.session.linked, !self.graph.listening else {
          throw OnDeviceError(message: OnDeviceError.alreadyListening)
        }
        guard AVAudioApplication.shared.recordPermission == .granted else {
          throw OnDeviceError(message: Self.permissionRequired)
        }
        guard Self.validRate(inputRate), Self.validRate(outputRate),
          Int(inputRate).isMultiple(of: AudioLinkPCM.chunksPerSecond) else {
          throw OnDeviceError(message: Self.invalidRate)
        }
        let input = try Input(rate: inputRate)
        let token = self.session.generation + 1
        self.session.generation = token
        self.outputRate = outputRate
        self.resetPlayback()
        opening = true
        self.session.onStopped = onStopped
        try self.graph.startPlayback()
        _ = try self.graph.startListening(onStopped: { [weak self] reason in
          self?.lost(reason, token: token)
        }) { [weak self] buffer, time in
          do {
            let chunks = try input.convert(buffer)
            let level = input.levels.update(buffer, at: time.hostTime)
            DispatchQueue.main.async { [weak self] in
              guard let self, self.session.linked, self.session.generation == token else { return }
              if let level { onLevel(level) }
              chunks.forEach { onInput($0.base64EncodedString()) }
            }
          } catch {
            DispatchQueue.main.async { self?.lost(Self.conversionFailed, token: token) }
          }
        }
        self.session.linked = true
        self.session.observer = NotificationCenter.default.addObserver(
          forName: OnDeviceAudioGraph.didInterruptPlayback, object: self.graph, queue: .main
        ) { [weak self] _ in
          // Graph loss delivers its precise reason after this notification.
          DispatchQueue.main.async { self?.lost(Self.interrupted, token: token) }
        }
        promise.resolve()
      } catch {
        if opening {
          self.graph.stopListening()
          self.graph.stopPlayback()
          self.session.onStopped = nil
        }
        promise.reject(withError: error)
      }
    }
    return promise
  }

  func play(chunk: String) throws {
    guard let bytes = Data(base64Encoded: chunk) else { throw OnDeviceError(message: Self.invalidChunk) }
    let samples = try AudioLinkPCM.floats(from: bytes)
    DispatchQueue.main.async {
      guard self.session.linked, !samples.isEmpty else { return }
      do { try self.play(samples) }
      catch { self.lost(Self.conversionFailed, token: self.session.generation) }
    }
  }

  private func play(_ samples: [Float]) throws {
    guard let sourceFormat = AVAudioFormat(standardFormatWithSampleRate: outputRate, channels: Self.channelCount),
      let targetFormat = AVAudioFormat(standardFormatWithSampleRate: OnDeviceAudioGraph.speechSampleRate,
        channels: Self.channelCount),
      let source = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(samples.count)) else {
      throw OnDeviceError(message: Self.conversionFailed)
    }
    source.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { source.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
    let output: AVAudioPCMBuffer
    if outputRate == OnDeviceAudioGraph.speechSampleRate { output = source }
    else {
      if outputConverter == nil { outputConverter = AVAudioConverter(from: sourceFormat, to: targetFormat) }
      guard let converter = outputConverter else { throw OnDeviceError(message: Self.conversionFailed) }
      output = try Self.convert(source, with: converter, to: targetFormat)
    }
    guard output.frameLength > 0 else { return }
    let render = graph.player.lastRenderTime
    let frame = render.flatMap { graph.player.playerTime(forNodeTime: $0) }?.sampleTime ?? 0
    playback.queue(frames: Int64(output.frameLength), at: frame)
    graph.player.scheduleBuffer(output)
    if !graph.player.isPlaying { graph.player.play() }
    startPlaybackClock()
  }

  func clear() throws {
    DispatchQueue.main.async {
      guard self.session.linked else { return }
      self.graph.player.stop()
      self.resetPlayback()
      self.graph.player.play()
    }
  }

  func playedMs() throws -> Double { playbackLock.withLock { playedMilliseconds } }

  private func startPlaybackClock() {
    guard playbackTimer == nil else { return }
    let timer = DispatchSource.makeTimerSource(queue: .main)
    timer.schedule(deadline: .now(), repeating: Self.playbackInterval)
    timer.setEventHandler { [weak self] in self?.updatePlaybackClock() }
    playbackTimer = timer
    timer.resume()
  }

  private func updatePlaybackClock() {
    guard session.linked, let render = graph.player.lastRenderTime,
      let time = graph.player.playerTime(forNodeTime: render), time.sampleRate > 0 else { return }
    let elapsed = Double(playback.advance(to: time.sampleTime)) / time.sampleRate * Self.millisecondsPerSecond
    playbackLock.withLock { playedMilliseconds = elapsed }
  }

  private func resetPlayback() {
    outputConverter = nil
    playback = AudioLinkPCM.Playback()
    playbackLock.withLock { playedMilliseconds = 0 }
  }

  func stop() throws { DispatchQueue.main.async { self.stopOnMain() } }

  private func lost(_ reason: String, token: Int) {
    guard session.linked, token == session.generation else { return }
    let callback = session.onStopped
    stopOnMain()
    callback?(reason)
  }

  private func stopOnMain() {
    guard session.linked else { return }
    if let observer = session.observer { NotificationCenter.default.removeObserver(observer) }
    session = Session(generation: session.generation + 1)
    playbackTimer?.cancel()
    playbackTimer = nil
    graph.stopListening()
    graph.stopPlayback()
    resetPlayback()
  }

  private static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter,
    to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
    let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate))
      + conversionHeadroom
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
      throw OnDeviceError(message: conversionFailed)
    }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, state in
      if supplied { state.pointee = .noDataNow; return nil }
      supplied = true
      state.pointee = .haveData
      return buffer
    }
    if let error { throw error }
    guard status != .error else { throw OnDeviceError(message: conversionFailed) }
    return output
  }

  private static func validRate(_ rate: Double) -> Bool {
    rate.isFinite && rate >= minimumRate && rate <= maximumRate && rate.rounded() == rate
  }

  deinit {
    if let observer = session.observer { NotificationCenter.default.removeObserver(observer) }
    playbackTimer?.cancel()
    if session.linked {
      let audio = graph
      DispatchQueue.main.async { audio.stopListening(); audio.stopPlayback() }
    }
  }
}

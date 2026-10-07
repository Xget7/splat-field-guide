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
        sampleRate: rate, channels: 1, interleaved: false) else {
        throw OnDeviceError(message: HybridAudioLink.invalidRate)
      }
      self.format = format
      chunks = AudioLinkPCM.Chunks(sampleRate: Int(rate))
    }

    func convert(_ buffer: AVAudioPCMBuffer) throws -> [Data] {
      if converter == nil { converter = AVAudioConverter(from: buffer.format, to: format) }
      guard let converter else { throw OnDeviceError(message: HybridAudioLink.conversionFailed) }
      let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate))
        + HybridAudioLink.conversionHeadroom
      guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
        throw OnDeviceError(message: HybridAudioLink.conversionFailed)
      }
      var supplied = false
      var error: NSError?
      let status = converter.convert(to: output, error: &error) { _, state in
        if supplied { state.pointee = .noDataNow; return nil }
        supplied = true
        state.pointee = .haveData
        return buffer
      }
      guard status != .error, error == nil, let samples = output.int16ChannelData else {
        if let error { throw error }
        throw OnDeviceError(message: HybridAudioLink.conversionFailed)
      }
      // Int16 channel data uses host byte order, while the bridge always uses little endian.
      let floats = (0..<Int(output.frameLength)).map { Float(samples[0][$0]) / AudioLinkPCM.scale }
      return try chunks.append(AudioLinkPCM.bytes(from: floats))
    }
  }

  private let graph = OnDeviceAudioGraph.shared
  private var linked = false
  private var generation = 0
  private var outputRate = OnDeviceAudioGraph.speechSampleRate
  private var outputConverter: AVAudioConverter?
  private var onStopped: ((String) -> Void)?
  private var observer: NSObjectProtocol?
  private var playback = AudioLinkPCM.Playback()
  private static let millisecondsPerSecond = 1000.0
  private static let minimumRate = 8_000.0
  private static let maximumRate = 192_000.0
  private static let conversionHeadroom: AVAudioFrameCount = 256
  private static let invalidRate = "Audio link requires supported whole sample rates and 100 ms input chunks"
  private static let permissionRequired = "Microphone permission required for audio link"
  private static let alreadyListening = "Speech input or audio link is already listening"
  private static let conversionFailed = "Audio link PCM conversion failed"
  private static let invalidChunk = "Audio link requires base64 little-endian PCM16"
  private static let interrupted = "Audio session interrupted"

  func start(inputRate: Double, outputRate: Double, onInput: @escaping (String) -> Void,
    onLevel: @escaping (Double) -> Void, onStopped: @escaping (String) -> Void) throws -> Promise<Void> {
    let promise = Promise<Void>()
    DispatchQueue.main.async { [self] in
      var opening = false
      do {
        guard !self.linked, !self.graph.listening else { throw OnDeviceError(message: Self.alreadyListening) }
        guard AVAudioApplication.shared.recordPermission == .granted else {
          throw OnDeviceError(message: Self.permissionRequired)
        }
        guard Self.validRate(inputRate), Self.validRate(outputRate),
          Int(inputRate).isMultiple(of: AudioLinkPCM.chunksPerSecond) else {
          throw OnDeviceError(message: Self.invalidRate)
        }
        let input = try Input(rate: inputRate)
        let token = self.generation + 1
        self.generation = token
        self.outputRate = outputRate
        self.outputConverter = nil
        self.playback = AudioLinkPCM.Playback()
        opening = true
        self.onStopped = onStopped
        try self.graph.startPlayback()
        _ = try self.graph.startListening(onStopped: { [weak self] reason in
          self?.lost(reason, token: token)
        }) { [weak self] buffer, time in
          do {
            let chunks = try input.convert(buffer)
            let level = input.levels.update(buffer, at: time.hostTime)
            DispatchQueue.main.async { [weak self] in
              guard let self, self.linked, self.generation == token else { return }
              if let level { onLevel(level) }
              chunks.forEach { onInput($0.base64EncodedString()) }
            }
          } catch {
            DispatchQueue.main.async { self?.lost(Self.conversionFailed, token: token) }
          }
        }
        self.linked = true
        self.observer = NotificationCenter.default.addObserver(
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
          self.onStopped = nil
        }
        promise.reject(withError: error)
      }
    }
    return promise
  }

  func play(chunk: String) throws {
    try onMain {
      guard linked else { return }
      guard let bytes = Data(base64Encoded: chunk) else { throw OnDeviceError(message: Self.invalidChunk) }
      let samples = try AudioLinkPCM.floats(from: bytes)
      guard !samples.isEmpty else { return }
      guard let sourceFormat = AVAudioFormat(standardFormatWithSampleRate: outputRate, channels: 1),
        let targetFormat = AVAudioFormat(standardFormatWithSampleRate: OnDeviceAudioGraph.speechSampleRate, channels: 1),
        let source = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(samples.count)) else {
        throw OnDeviceError(message: Self.conversionFailed)
      }
      source.frameLength = AVAudioFrameCount(samples.count)
      samples.withUnsafeBufferPointer { source.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
      let output: AVAudioPCMBuffer
      if outputRate == OnDeviceAudioGraph.speechSampleRate { output = source }
      else {
        if outputConverter == nil { outputConverter = AVAudioConverter(from: sourceFormat, to: targetFormat) }
        guard let converter = outputConverter,
          let converted = AVAudioPCMBuffer(pcmFormat: targetFormat,
            frameCapacity: AVAudioFrameCount(ceil(Double(samples.count) * targetFormat.sampleRate / outputRate))
              + Self.conversionHeadroom) else { throw OnDeviceError(message: Self.conversionFailed) }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: converted, error: &error) { _, state in
          if supplied { state.pointee = .noDataNow; return nil }
          supplied = true
          state.pointee = .haveData
          return source
        }
        guard status != .error, error == nil else {
          if let error { throw error }
          throw OnDeviceError(message: Self.conversionFailed)
        }
        output = converted
      }
      guard output.frameLength > 0 else { return }
      let render = graph.player.lastRenderTime
      let frame = render.flatMap { graph.player.playerTime(forNodeTime: $0) }?.sampleTime ?? 0
      playback.queue(frames: Int64(output.frameLength), at: frame)
      graph.player.scheduleBuffer(output)
      if !graph.player.isPlaying { graph.player.play() }
    }
  }

  func clear() throws {
    onMain {
      guard linked else { return }
      graph.player.stop()
      outputConverter?.reset()
      playback = AudioLinkPCM.Playback()
      graph.player.play()
    }
  }

  func playedMs() throws -> Double {
    onMain {
      guard linked, let render = graph.player.lastRenderTime,
        let time = graph.player.playerTime(forNodeTime: render), time.sampleRate > 0 else { return 0 }
      // An idle player's clock advances through silence, which is not remote speech.
      return Double(playback.played(at: time.sampleTime)) / time.sampleRate * Self.millisecondsPerSecond
    }
  }

  func stop() throws { onMain { stopOnMain() } }

  private func lost(_ reason: String, token: Int) {
    guard linked, token == generation else { return }
    let callback = onStopped
    stopOnMain()
    callback?(reason)
  }

  private func stopOnMain() {
    guard linked else { return }
    linked = false
    generation += 1
    onStopped = nil
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    graph.stopListening()
    graph.stopPlayback()
    outputConverter = nil
    playback = AudioLinkPCM.Playback()
  }

  private static func validRate(_ rate: Double) -> Bool {
    rate.isFinite && rate >= minimumRate && rate <= maximumRate && rate.rounded() == rate
  }

  private func onMain<T>(_ action: () throws -> T) rethrows -> T {
    if Thread.isMainThread { return try action() }
    return try DispatchQueue.main.sync(execute: action)
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    if linked {
      let audio = graph
      DispatchQueue.main.async { audio.stopListening(); audio.stopPlayback() }
    }
  }
}

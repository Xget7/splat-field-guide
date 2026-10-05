import AVFoundation

/// The audio engine speech plays through. Listening taps the same engine with
/// voice processing on, so echo cancellation has a reference for Kokoro playback.
/// Apple fallback plays outside this graph and still needs caller-side echo filtering. Main queue only.
final class OnDeviceAudioGraph: ConversationAudio {
  static let shared = OnDeviceAudioGraph()
  static let speechSampleRate: Double = 24_000

  private(set) var engine = AVAudioEngine()
  private(set) var player = AVAudioPlayerNode()
  private let speechFormat: AVAudioFormat
  private var onListeningStopped: ((String) -> Void)?
  private var observers: [NSObjectProtocol] = []
  private var playing = false
  private(set) var listening = false

  private init() {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: Self.speechSampleRate,
      channels: 1) else { preconditionFailure("Mono float audio is always available") }
    speechFormat = format
    attachPlayer()
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil,
        queue: .main) { [weak self] notification in
        guard let self, notification.object as AnyObject? === self.engine else { return }
        self.audioLost(Self.engineChanged)
      },
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil,
        queue: .main) { [weak self] notification in
        guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          type == AVAudioSession.InterruptionType.began.rawValue else { return }
        self?.audioLost(Self.audioInterrupted)
      },
    ]
  }

  /// Gets the player ready for 24 kHz mono speech buffers.
  func startPlayback() throws {
    try OnDeviceAudioSession.activate()
    try startEngine()
    playing = true
  }

  /// Stops speech; the engine keeps running only while it is also listening.
  func stopPlayback() {
    player.stop()
    playing = false
    if !listening { engine.stop() }
  }

  /// Opens the microphone with echo cancellation and taps it until `stopListening`.
  func startListening(onStopped: @escaping (String) -> Void, tap: @escaping AVAudioNodeTapBlock) throws -> AVAudioFormat {
    try OnDeviceAudioSession.activate()
    stopListening()
    interruptPlayback()
    engine.stop()
    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
    // Ducking other audio is for calls; here only the app itself is playing.
    input.voiceProcessingOtherAudioDuckingConfiguration =
      AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false,
        duckingLevel: .min)
    // Voice processing changes the engine's I/O formats, so the player is reconnected.
    engine.connect(player, to: engine.mainMixerNode, format: speechFormat)
    let format = input.outputFormat(forBus: OnDeviceAudioGraph.inputBus)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      reset()
      throw OnDeviceError(message: "Microphone audio format unavailable")
    }
    input.installTap(onBus: OnDeviceAudioGraph.inputBus, bufferSize: OnDeviceAudioGraph.tapBufferSize,
      format: format, block: tap)
    onListeningStopped = onStopped
    listening = true
    do { try startEngine() } catch {
      stopListening()
      throw error
    }
    return format
  }

  /// Closes the microphone. A fresh engine follows, because one whose input was ever used
  /// keeps the microphone open while it runs, even for speech alone.
  func stopListening() {
    guard listening else { return }
    listening = false
    onListeningStopped = nil
    engine.inputNode.removeTap(onBus: OnDeviceAudioGraph.inputBus)
    reset()
  }

  private static let engineChanged = "Audio engine configuration changed"
  private static let audioInterrupted = "Audio session interrupted"

  private func audioLost(_ reason: String) {
    let stopped = onListeningStopped
    stopListening()
    if stopped == nil { reset() }
    // Also cancels synthesis and Apple fallback, which need not be playing in this engine.
    NotificationCenter.default.post(name: Self.didInterruptPlayback, object: self)
    stopped?(reason)
  }

  private static let inputBus: AVAudioNodeBus = 0
  private static let tapBufferSize: AVAudioFrameCount = 1024

  private func startEngine() throws {
    guard !engine.isRunning else { return }
    engine.prepare()
    try engine.start()
  }

  private func reset() {
    interruptPlayback()
    engine.stop()
    engine = AVAudioEngine()
    player = AVAudioPlayerNode()
    attachPlayer()
  }

  private func interruptPlayback() {
    guard playing else { return }
    playing = false
    player.stop()
    NotificationCenter.default.post(name: OnDeviceAudioGraph.didInterruptPlayback, object: self)
  }

  private func attachPlayer() {
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: speechFormat)
  }

  /// Posted on main when the microphone takes over or system audio is lost.
  static let didInterruptPlayback = Notification.Name("OnDeviceAudioGraphDidInterruptPlayback")
}

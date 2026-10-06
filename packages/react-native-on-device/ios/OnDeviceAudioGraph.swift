import AVFoundation

// Main queue only, sharing Kokoro playback for echo cancellation while Apple fallback needs caller-side filtering.
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

  func startPlayback() throws {
    try OnDeviceAudioSession.activate()
    try startEngine()
    playing = true
  }

  func stopPlayback() {
    player.stop()
    playing = false
    if !listening { engine.stop() }
  }

  func startListening(onStopped: @escaping (String) -> Void, tap: @escaping AVAudioNodeTapBlock) throws -> AVAudioFormat {
    try OnDeviceAudioSession.activate()
    stopListening()
    interruptPlayback()
    engine.stop()
    let input = engine.inputNode
    try input.setVoiceProcessingEnabled(true)
    // Minimize ducking because only the app's own audio is playing.
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

  // Replacing the engine releases a microphone that would otherwise stay open during playback.
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

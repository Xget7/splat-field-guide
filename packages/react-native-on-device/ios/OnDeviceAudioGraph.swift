import AVFoundation

/// The audio engine speech plays through. Hands-free listening taps the same engine with
/// voice processing on, so echo cancellation hears what the app says and only the user's
/// voice reaches recognition, which lets the user talk over an answer. Main queue only.
final class OnDeviceAudioGraph {
  static let shared = OnDeviceAudioGraph()
  static let speechSampleRate: Double = 24_000

  private(set) var engine = AVAudioEngine()
  private(set) var player = AVAudioPlayerNode()
  private let speechFormat: AVAudioFormat
  private var playing = false
  private(set) var listening = false

  private init() {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: Self.speechSampleRate,
      channels: 1) else { preconditionFailure("Mono float audio is always available") }
    speechFormat = format
    attachPlayer()
  }

  /// Gets the player ready for 24 kHz mono speech buffers.
  func startPlayback() throws {
    try OnDeviceAudioSession.activate()
    playing = true
    try startEngine()
  }

  /// Stops speech; the engine keeps running only while it is also listening.
  func stopPlayback() {
    player.stop()
    playing = false
    if !listening { engine.stop() }
  }

  /// Opens the microphone with echo cancellation and taps it until `stopListening`.
  func startListening(tap: @escaping AVAudioNodeTapBlock) throws -> AVAudioFormat {
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
    engine.inputNode.removeTap(onBus: OnDeviceAudioGraph.inputBus)
    reset()
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

  /// Posted on the main queue when the microphone takes the engine over and speech stops.
  static let didInterruptPlayback = Notification.Name("OnDeviceAudioGraphDidInterruptPlayback")
}

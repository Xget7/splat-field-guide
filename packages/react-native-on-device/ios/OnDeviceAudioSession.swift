import AVFoundation

// Both speech modules serialize their state and audio session changes on the main queue.
enum OnDeviceAudioSession {
  static func activate() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [
      .defaultToSpeaker, .allowBluetoothA2DP,
    ])
    try session.setActive(true)
  }
}

struct OnDeviceError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

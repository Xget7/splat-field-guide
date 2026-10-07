import AVFoundation

// Both speech modules serialize their state and audio session changes on the main queue.
enum OnDeviceAudioSession {
  static func activate() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [
      .defaultToSpeaker, .allowBluetoothA2DP,
    ])
    try session.setActive(true)
    _ = observers
  }

  /// The current inputs, outputs, hardware rate and mode, for the conversation log.
  static var route: String {
    let session = AVAudioSession.sharedInstance()
    let ports = { (ports: [AVAudioSessionPortDescription]) in
      ports.map(\.portType.rawValue).joined(separator: "+")
    }
    return "in \(ports(session.currentRoute.inputs)), out \(ports(session.currentRoute.outputs)), "
      + "\(Int(session.sampleRate)) Hz, mode \(session.mode.rawValue)"
  }

  private static let observers: [NSObjectProtocol] = {
    let center = NotificationCenter.default
    return [
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil,
        queue: .main) { notification in
        let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
        OnDeviceLog.voice("Route changed (reason \(reason)): \(route)")
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil,
        queue: .main) { _ in OnDeviceLog.voice("Media services were reset") },
    ]
  }()
}

struct OnDeviceError: LocalizedError {
  static let alreadyListening = "Speech input or audio link is already listening"
  let message: String
  var errorDescription: String? { message }
}

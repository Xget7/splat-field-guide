import Accelerate
import AVFoundation

// Owned by one input tap and accessed only on its audio thread.
final class OnDeviceAudioLevel {
  private static let noiseFloorDB = -50.0
  private static let ceilingDB = -10.0
  private static let attackSeconds = 0.035
  private static let releaseSeconds = 0.18
  private static let silenceThreshold = 0.005
  private static let maximumUpdatesPerSecond = 30.0

  private let minimumInterval = AVAudioTime.hostTime(
    forSeconds: 1 / maximumUpdatesPerSecond) + 1
  private var lastEmission: UInt64?
  private var smoothedLevel = 0.0

  func update(_ buffer: AVAudioPCMBuffer, at hostTime: UInt64) -> Double? {
    guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return nil }
    let channelCount = Int(buffer.format.channelCount)
    guard channelCount > 0 else { return nil }
    let interleaved = buffer.format.isInterleaved
    let stride = vDSP_Stride(interleaved ? channelCount : 1)
    var meanSquare = 0.0
    for channel in 0..<channelCount {
      let samples = interleaved ? channels[0].advanced(by: channel) : channels[channel]
      var channelMeanSquare: Float = 0
      vDSP_measqv(samples, stride, &channelMeanSquare, vDSP_Length(buffer.frameLength))
      meanSquare += Double(channelMeanSquare)
    }
    let rms = sqrt(meanSquare / Double(channelCount))
    let db = rms > 0 ? 20 * log10(rms) : Self.noiseFloorDB
    let target = min(1, max(0, (db - Self.noiseFloorDB) / (Self.ceilingDB - Self.noiseFloorDB)))
    let duration = Double(buffer.frameLength) / buffer.format.sampleRate
    let smoothing = target > smoothedLevel ? Self.attackSeconds : Self.releaseSeconds
    smoothedLevel += (target - smoothedLevel) * (1 - exp(-duration / smoothing))
    if target == 0, smoothedLevel < Self.silenceThreshold { smoothedLevel = 0 }

    if let lastEmission {
      guard hostTime >= lastEmission, hostTime - lastEmission >= minimumInterval else { return nil }
    }
    lastEmission = hostTime
    return smoothedLevel
  }
}

// Owned by one audio tap, with the voice threshold set against the preceding quiet samples.
final class OnDeviceVoiceActivity {
  enum Change { case started, ended }

  // Levels are 0 to 1 over 40 dB, so 0.2 is 8 dB.
  private static let margin = 0.2
  // The absolute threshold is about -42 dBFS, low enough for a voice from arm's length.
  private static let minimumVoice = 0.2
  // Only quiet samples enter this window, so sustained speech cannot raise its own threshold.
  private static let floorWindow: TimeInterval = 3
  // Sustained onset excludes clicks and knocks.
  private static let onset: TimeInterval = 0.1
  // The pause must outlast gaps between words and a breath between phrases.
  static let endPause: TimeInterval = 0.9
  private static let longestTurn: TimeInterval = 20

  private var recent: [(time: TimeInterval, level: Double)] = []
  private var louderSince: TimeInterval?
  private var speakingSince: TimeInterval?
  private var lastVoice: TimeInterval = 0
  private var noiseFloor = 0.0

  // time is in seconds.
  func update(_ level: Double, at time: TimeInterval) -> Change? {
    if speakingSince == nil, louderSince == nil {
      recent.removeAll { time - $0.time > Self.floorWindow }
      noiseFloor = recent.map(\.level).min() ?? level
    }
    let voice = level >= max(noiseFloor + Self.margin, Self.minimumVoice)

    guard let since = speakingSince else {
      guard voice else {
        recent.append((time, level))
        louderSince = nil
        return nil
      }
      let start = louderSince ?? time
      louderSince = start
      guard time - start >= Self.onset else { return nil }
      louderSince = nil
      speakingSince = time
      lastVoice = time
      return .started
    }
    if voice { lastVoice = time }
    guard time - lastVoice >= Self.endPause || time - since >= Self.longestTurn else { return nil }
    speakingSince = nil
    return .ended
  }
}

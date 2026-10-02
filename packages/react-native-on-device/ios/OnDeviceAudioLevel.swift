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

/// Whether someone is talking, read from the microphone level against the room's own noise:
/// speech has to stand clear of the quietest level of the last few seconds, so a fan, an engine
/// or a crowd does not count as a voice however loud it is. Owned by one input tap and accessed
/// only on its audio thread.
final class OnDeviceVoiceActivity {
  enum Change { case started, ended }

  // Levels are 0 to 1 over 40 dB, so 0.2 is 8 dB.
  private static let margin = 0.2
  // About -40 dBFS: below this nothing is a voice, however still the room.
  private static let minimumVoice = 0.25
  // The quietest level over this long is the room's noise; speech always pauses within it.
  private static let floorWindow: TimeInterval = 3
  // Louder for this long is a voice rather than a click or a knock.
  private static let onset: TimeInterval = 0.1
  // Quiet for this long ends a turn: past the gaps between words, short of a felt wait.
  static let endPause: TimeInterval = 0.7
  // A voice that never pauses, such as a radio, still ends its turn after this long.
  private static let longestTurn: TimeInterval = 20

  private var recent: [(time: TimeInterval, level: Double)] = []
  private var louderSince: TimeInterval?
  private var speakingSince: TimeInterval?
  private var lastVoice: TimeInterval = 0

  /// Takes the level at `time`, in seconds, and returns the change it makes, if any.
  func update(_ level: Double, at time: TimeInterval) -> Change? {
    recent.removeAll { time - $0.time > Self.floorWindow }
    let floor = recent.map(\.level).min() ?? level
    recent.append((time, level))
    let voice = level >= max(floor + Self.margin, Self.minimumVoice)

    guard let since = speakingSince else {
      guard voice else {
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

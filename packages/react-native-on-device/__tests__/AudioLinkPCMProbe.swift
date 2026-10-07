import Foundation

@main
struct AudioLinkPCMProbe {
  private static let inputSampleRate = 16_000
  private static let firstInputSamples = 4000
  private static let totalInputSamples = 4800
  private static let playbackChunkFrames: Int64 = 2400
  private static let playbackHalfChunk: Int64 = 1200
  private static let playbackPartialFrames: Int64 = 3600
  private static let playbackGapFrame: Int64 = 12_000
  private static let playbackResumedFrame: Int64 = 13_200
  static func main() throws {
    let result: [String: Any]
    switch CommandLine.arguments.last {
    case "literal":
      let sample = try AudioLinkPCM.floats(from: Data([0x02, 0x01])).first!
      result = ["decoded": Int((sample * AudioLinkPCM.scale).rounded()),
        "encoded": Array(AudioLinkPCM.bytes(from: [Float(0x0102) / AudioLinkPCM.scale]))]
    case "clipping":
      result = ["bytes": Array(AudioLinkPCM.bytes(from: [1.5, -1.5]))]
    case "roundTrip":
      let original: [Int16] = [.min, -20_000, -1, 0, 1, 20_000, .max]
      let bytes = Data(original.flatMap { sample -> [UInt8] in
        let bits = UInt16(bitPattern: sample)
        return [UInt8(truncatingIfNeeded: bits), UInt8(truncatingIfNeeded: bits >> 8)]
      })
      let restored = try AudioLinkPCM.floats(from: AudioLinkPCM.bytes(from: AudioLinkPCM.floats(from: bytes)))
        .map { Int(($0 * AudioLinkPCM.scale).rounded()) }
      result = ["original": original.map(Int.init), "restored": restored]
    case "playback":
      var playback = AudioLinkPCM.Playback()
      playback.queue(frames: playbackChunkFrames, at: 0)
      playback.queue(frames: playbackChunkFrames, at: playbackHalfChunk)
      let partial = playback.advance(to: playbackPartialFrames)
      let finished = playback.advance(to: playbackGapFrame)
      playback.queue(frames: playbackChunkFrames, at: playbackGapFrame)
      let resumed = playback.advance(to: playbackResumedFrame)
      playback = AudioLinkPCM.Playback()
      result = ["partial": partial, "finished": finished, "resumed": resumed,
        "cleared": playback.advance(to: 0)]
    case "chunks":
      var chunks = AudioLinkPCM.Chunks(sampleRate: inputSampleRate)
      let first = try chunks.append(AudioLinkPCM.bytes(from: (0..<firstInputSamples).map { Float($0) / AudioLinkPCM.scale }))
      let second = try chunks.append(AudioLinkPCM.bytes(from: (firstInputSamples..<totalInputSamples).map { Float($0) / AudioLinkPCM.scale }))
      let samples = try (first + second).flatMap { try AudioLinkPCM.floats(from: $0) }
        .map { Int(($0 * AudioLinkPCM.scale).rounded()) }
      result = ["first": first.map(\.count), "second": second.map(\.count),
        "remaining": chunks.pendingSamples, "samples": samples]
    default:
      do {
        _ = try AudioLinkPCM.floats(from: Data([1]))
        result = ["rejected": false]
      } catch { result = ["rejected": true] }
    }
    print(String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self))
  }
}

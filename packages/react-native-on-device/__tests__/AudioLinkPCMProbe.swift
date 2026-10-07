import Foundation

@main
struct AudioLinkPCMProbe {
  static func main() throws {
    let result: [String: Any]
    switch CommandLine.arguments.last {
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
      playback.queue(frames: 2400, at: 0)
      playback.queue(frames: 2400, at: 1200)
      let partial = playback.played(at: 3600)
      let finished = playback.played(at: 12_000)
      playback.queue(frames: 2400, at: 12_000)
      let resumed = playback.played(at: 13_200)
      playback = AudioLinkPCM.Playback()
      result = ["partial": partial, "finished": finished, "resumed": resumed,
        "cleared": playback.played(at: 0)]
    case "chunks":
      var chunks = AudioLinkPCM.Chunks(sampleRate: 16_000)
      let first = try chunks.append(AudioLinkPCM.bytes(from: (0..<4000).map { Float($0) / AudioLinkPCM.scale }))
      let second = try chunks.append(AudioLinkPCM.bytes(from: (4000..<4800).map { Float($0) / AudioLinkPCM.scale }))
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

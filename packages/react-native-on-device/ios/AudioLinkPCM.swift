import Foundation

enum AudioLinkPCM {
  static let scale: Float = 32_768
  static let bytesPerSample = 2
  static let chunksPerSecond = 10
  enum Failure: Error { case oddByteCount }

  static func floats(from bytes: Data) throws -> [Float] {
    guard bytes.count.isMultiple(of: bytesPerSample) else { throw Failure.oddByteCount }
    let values = [UInt8](bytes)
    return stride(from: 0, to: values.count, by: bytesPerSample).map { index in
      let bits = UInt16(values[index]) | (UInt16(values[index + 1]) << 8)
      return Float(Int16(bitPattern: bits)) / scale
    }
  }

  static func bytes(from samples: [Float]) -> Data {
    var bytes = Data(capacity: samples.count * bytesPerSample)
    for sample in samples {
      let value = sample.isFinite ? sample : 0
      let bounded = min(Float(Int16.max), max(Float(Int16.min), (value * scale).rounded()))
      let bits = UInt16(bitPattern: Int16(bounded))
      bytes.append(UInt8(truncatingIfNeeded: bits))
      bytes.append(UInt8(truncatingIfNeeded: bits >> 8))
    }
    return bytes
  }

  // Only scheduled speech enters the elapsed time, excluding empty-player clock gaps.
  struct Playback {
    private var segments: [Range<Int64>] = []
    private var completed: Int64 = 0
    private var end: Int64 = 0

    mutating func queue(frames: Int64, at rendered: Int64) {
      let start = max(end, rendered)
      end = start + frames
      segments.append(start..<end)
    }

    mutating func advance(to rendered: Int64) -> Int64 {
      var finished = 0
      var result = completed
      for segment in segments {
        if rendered >= segment.upperBound {
          let count = segment.upperBound - segment.lowerBound
          completed += count
          result += count
          finished += 1
        } else {
          result += max(0, rendered - segment.lowerBound)
          break
        }
      }
      if finished > 0 { segments.removeFirst(finished) }
      return result
    }
  }

  struct Chunks {
    private let chunkBytes: Int
    private var pending = Data()
    var pendingSamples: Int { pending.count / AudioLinkPCM.bytesPerSample }

    init(sampleRate: Int) {
      precondition(sampleRate > 0 && sampleRate.isMultiple(of: AudioLinkPCM.chunksPerSecond))
      chunkBytes = sampleRate / AudioLinkPCM.chunksPerSecond * AudioLinkPCM.bytesPerSample
    }

    mutating func append(_ bytes: Data) throws -> [Data] {
      guard bytes.count.isMultiple(of: AudioLinkPCM.bytesPerSample) else { throw Failure.oddByteCount }
      pending.append(bytes)
      var chunks: [Data] = []
      var consumed = 0
      while pending.count - consumed >= chunkBytes {
        let start = pending.startIndex + consumed
        chunks.append(pending.subdata(in: start..<(start + chunkBytes)))
        consumed += chunkBytes
      }
      if consumed > 0 { pending.removeFirst(consumed) }
      return chunks
    }
  }
}

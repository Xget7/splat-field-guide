import Foundation

/// An immutable, bounded exact index for precomputed part prototypes.
struct PartRetrievalIndex {
  let partIds: [String]
  let dimensions: Int
  private let vectors: [[Double]]
  static let maximumParts = 10000

  init(bytes: Data, partIds: [String], dimensions: Int) throws {
    guard dimensions > 0, dimensions <= 4096, !partIds.isEmpty,
      partIds.count <= Self.maximumParts, Set(partIds).count == partIds.count,
      partIds.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 256 }),
      bytes.count == partIds.count * dimensions * MemoryLayout<UInt32>.size
    else { throw PartRetrievalFailure.invalid("Invalid prototype shape or identities") }
    var rows: [[Double]] = []
    for row in partIds.indices {
      let values = (0..<dimensions).map { column in
        let offset = (row * dimensions + column) * MemoryLayout<UInt32>.size
        let bits = bytes.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self) }
        return Double(Float(bitPattern: UInt32(littleEndian: bits)))
      }
      let norm = values.reduce(0) { $0 + $1 * $1 }.squareRoot()
      guard values.allSatisfy(\.isFinite), abs(norm - 1) <= 0.001 else {
        throw PartRetrievalFailure.invalid("Prototype must be finite and normalized")
      }
      rows.append(values.map { $0 / norm })
    }
    self.partIds = partIds
    self.dimensions = dimensions
    vectors = rows
  }

  func search(embedding: [Double], limit: Int) throws -> [(partId: String, score: Double)] {
    guard limit > 0, limit <= 100, embedding.count == dimensions,
      embedding.allSatisfy(\.isFinite) else {
      throw PartRetrievalFailure.invalid("Invalid embedding or result limit")
    }
    let norm = embedding.reduce(0) { $0 + $1 * $1 }.squareRoot()
    guard norm.isFinite, norm > 0 else { throw PartRetrievalFailure.invalid("Zero or invalid embedding norm") }
    let query = embedding.map { $0 / norm }
    var ranking: [(partId: String, score: Double)] = []
    for row in vectors.indices {
      var score = 0.0
      for column in 0..<dimensions { score += query[column] * vectors[row][column] }
      ranking.append((partId: partIds[row], score: score))
    }
    ranking.sort { a, b in
      a.score == b.score ? a.partId < b.partId : a.score > b.score
    }
    return Array(ranking.prefix(limit))
  }
}

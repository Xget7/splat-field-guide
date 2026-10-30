import CryptoKit
import Foundation

@main
enum PartRetrievalProbe {
  static func require(_ value: Bool, _ message: String) throws {
    if !value { throw PartRetrievalFailure.invalid("Test failed: \(message)") }
  }

  static func rejects(_ operation: () throws -> Void) throws {
    do {
      try operation()
    } catch { return }
    throw PartRetrievalFailure.invalid("Expected rejection")
  }

  static func bytes(_ values: [Float]) -> Data {
    var result = Data()
    for value in values {
      var bits = value.bitPattern.littleEndian
      withUnsafeBytes(of: &bits) { result.append(contentsOf: $0) }
    }
    return result
  }

  static func main() throws {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let mode = args.first else { throw PartRetrievalFailure.invalid("Missing mode") }
    if mode == "index" {
      let index = try PartRetrievalIndex(bytes: bytes([1, 0, 0, 1, 1, 0]),
        partIds: ["part-b", "part-c", "part-a"], dimensions: 2)
      let ranks = try index.search(embedding: [5, 0], limit: 2)
      try require(ranks.map(\.partId) == ["part-a", "part-b"], "normalized query and stable tie ordering")
      try require(ranks.allSatisfy({ abs($0.score - 1) < 0.000001 }), "cosine scores")
      try rejects { _ = try index.search(embedding: [0, 0], limit: 1) }
      try rejects { _ = try index.search(embedding: [Double.nan, 1], limit: 1) }
      try rejects { _ = try index.search(embedding: [1], limit: 1) }
      try rejects { _ = try index.search(embedding: [1, 0], limit: 101) }
      try rejects { _ = try PartRetrievalIndex(bytes: bytes([1, 0, 0, 1]), partIds: ["same", "same"], dimensions: 2) }
      try rejects { _ = try PartRetrievalIndex(bytes: bytes([Float.infinity, 0]), partIds: ["part"], dimensions: 2) }
      try rejects { _ = try PartRetrievalIndex(bytes: bytes([2, 0]), partIds: ["part"], dimensions: 2) }
      try rejects { _ = try PartRetrievalIndex(bytes: bytes([0, 0]), partIds: ["part"], dimensions: 2) }
      try rejects { _ = try PartRetrievalIndex(bytes: Data([0]), partIds: ["part"], dimensions: 2) }
      print("index checks passed")
    } else if mode == "receipt" {
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      try Data("{}".utf8).write(to: directory.appendingPathComponent("receipt.json"))
      try rejects { _ = try PartRetrievalEngine(directory: directory, expectedReceiptSha256: String(repeating: "0", count: 64)) }
      try rejects { _ = try PartRetrievalEngine(directory: directory, expectedReceiptSha256: "wrong") }
      print("receipt checks passed")
    } else if mode == "corpus" {
      guard args.count == 5 else { throw PartRetrievalFailure.invalid("Expected directory, digest, frozen corpus and token IDs") }
      let directory = URL(fileURLWithPath: args[1])
      let tokenizer = try PartRetrievalTokenizer(
        vocabulary: Data(contentsOf: directory.appendingPathComponent("vocab.json")),
        merges: Data(contentsOf: directory.appendingPathComponent("merges.txt")))
      let corpus = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[3]))) as! [String: Any]
      let queries = corpus["queries"] as! [[String: Any]]
      let tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[4]))) as! [String: Any]
      let expected = tokens["mobileclip"] as! [[Int]]
      let engine = try PartRetrievalEngine(directory: directory, expectedReceiptSha256: args[2])
      var rows: [[String: Any]] = []
      for (index, query) in queries.enumerated() {
        let text = query["text"] as! String
        try require(try tokenizer.encode(text) == expected[index], "token parity for \(text)")
        let start = Date()
        let ranking = try engine.search(text: text, limit: 100)
        rows.append(["text": text, "seconds": Date().timeIntervalSince(start),
          "ranking": ranking.map { ["partId": $0.partId, "score": $0.score] as [String: Any] }])
      }
      for invalid in ["", "  \n ", "café", "&amp;", "<start_of_text>", String(repeating: "air ", count: 300), String(repeating: "1 ", count: 76)] {
        try rejects { _ = try tokenizer.encode(invalid) }
      }
      try require(try tokenizer.encode("  THE\nMOUSE \t") == tokenizer.encode("the mouse"), "ASCII normalization")
      let result: [String: Any] = ["spaceId": engine.spaceId, "parts": engine.partIds,
        "tokenParity": queries.count, "rows": rows]
      let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
      print(String(data: data, encoding: .utf8)!)
    } else {
      throw PartRetrievalFailure.invalid("Unknown probe mode")
    }
  }
}

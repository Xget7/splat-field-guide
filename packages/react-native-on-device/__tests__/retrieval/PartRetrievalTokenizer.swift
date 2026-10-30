import Foundation

enum PartRetrievalFailure: Error, LocalizedError {
  case invalid(String)

  var errorDescription: String? {
    switch self {
    case .invalid(let reason): return "Part retrieval: \(reason)"
    }
  }
}

/// The initial evaluation accepts plain ASCII English, where cleaning is exactly defined.
/// Unsupported Unicode and entity markup reject rather than approximate another tokenizer.
final class PartRetrievalTokenizer {
  private struct Pair: Hashable {
    let first: String
    let second: String
  }

  private let vocabulary: [String: Int]
  private let ranks: [Pair: Int]
  private let pattern = try! NSRegularExpression(
    pattern: "'s|'t|'re|'ve|'m|'ll|'d|[a-z]+|[0-9]|[^\\sa-z0-9]+")
  static let contextLength = 77
  static let maximumInputBytes = 1024
  private static let startToken = 49406
  private static let endToken = 49407

  init(vocabulary: Data, merges: Data) throws {
    self.vocabulary = try JSONDecoder().decode([String: Int].self, from: vocabulary)
    guard self.vocabulary.count == 49408,
      Set(self.vocabulary.values) == Set(0..<49408),
      self.vocabulary["<start_of_text>"] == Self.startToken,
      self.vocabulary["<end_of_text>"] == Self.endToken,
      let text = String(data: merges, encoding: .utf8)
    else { throw PartRetrievalFailure.invalid("Invalid tokenizer vocabulary") }
    var ranks: [Pair: Int] = [:]
    for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
      if line.hasPrefix("#version:") { continue }
      let symbols = line.split(separator: " ", omittingEmptySubsequences: false)
      guard symbols.count == 2, !symbols[0].isEmpty, !symbols[1].isEmpty else {
        throw PartRetrievalFailure.invalid("Invalid tokenizer merge")
      }
      let pair = Pair(first: String(symbols[0]), second: String(symbols[1]))
      guard ranks[pair] == nil else { throw PartRetrievalFailure.invalid("Duplicate tokenizer merge") }
      ranks[pair] = ranks.count
    }
    guard ranks.count == 48894 else { throw PartRetrievalFailure.invalid("Invalid tokenizer merge count") }
    self.ranks = ranks
  }

  func encode(_ text: String) throws -> [Int] {
    guard !text.isEmpty, text.utf8.count <= Self.maximumInputBytes,
      text.utf8.allSatisfy({ (32...126).contains($0) || [9, 10, 13].contains($0) }),
      !text.contains("&"), !text.contains("<"), !text.contains(">")
    else { throw PartRetrievalFailure.invalid("Use plain ASCII English without markup, at most 1024 bytes") }
    let cleaned = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
    guard !cleaned.isEmpty else { throw PartRetrievalFailure.invalid("Empty query") }
    let range = NSRange(cleaned.startIndex..<cleaned.endIndex, in: cleaned)
    var result = [Self.startToken]
    for match in pattern.matches(in: cleaned, range: range) {
      guard let tokenRange = Range(match.range, in: cleaned) else {
        throw PartRetrievalFailure.invalid("Invalid token range")
      }
      for symbol in merge(String(cleaned[tokenRange])) {
        guard let id = vocabulary[symbol] else { throw PartRetrievalFailure.invalid("Unknown token") }
        result.append(id)
      }
      guard result.count < Self.contextLength else {
        throw PartRetrievalFailure.invalid("Query exceeds 75 text tokens")
      }
    }
    result.append(Self.endToken)
    result.append(contentsOf: repeatElement(0, count: Self.contextLength - result.count))
    return result
  }

  private func merge(_ token: String) -> [String] {
    var symbols = token.map(String.init)
    symbols[symbols.count - 1] += "</w>"
    while symbols.count > 1 {
      var selected: Pair?
      var best = Int.max
      for index in 0..<(symbols.count - 1) {
        let pair = Pair(first: symbols[index], second: symbols[index + 1])
        if let rank = ranks[pair], rank < best {
          selected = pair
          best = rank
        }
      }
      guard let selected else { break }
      var merged: [String] = []
      var index = 0
      while index < symbols.count {
        if index + 1 < symbols.count, symbols[index] == selected.first,
          symbols[index + 1] == selected.second {
          merged.append(symbols[index] + symbols[index + 1])
          index += 2
        } else {
          merged.append(symbols[index])
          index += 1
        }
      }
      symbols = merged
    }
    return symbols
  }
}

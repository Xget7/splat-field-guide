import Foundation

struct SpeechSentence {
  let text: String
  let range: NSRange
  let words: [NSRange]
}

enum SpeechTextPlan {
  // Kokoro renders whole chunks, so a shorter first chunk reduces initial playback latency.
  private static let chunkLimit = 180
  private static let firstChunkLimit = 80
  private static let firstChunkMinimum = 24
  private static let clauseEnds: Set<Character> = [",", ";", ":"]

  // Chunk limits reduce phoneme overflow risk while ranges retain the original text's UTF-16 offsets.
  static func sentences(in text: String) -> [SpeechSentence] {
    var ranges: [Range<String.Index>] = []
    text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .bySentences) {
      _, range, _, _ in ranges.append(range)
    }
    if ranges.isEmpty, !text.isEmpty { ranges = [text.startIndex..<text.endIndex] }
    var sentences: [SpeechSentence] = []
    for range in ranges {
      var start = range.lowerBound
      while start < range.upperBound {
        let first = sentences.isEmpty
        let limit = text.index(start, offsetBy: first ? firstChunkLimit : chunkLimit,
          limitedBy: range.upperBound) ?? range.upperBound
        var end = limit
        if limit < range.upperBound {
          let window = text[start..<limit]
          let minimum = text.index(start, offsetBy: firstChunkMinimum, limitedBy: limit) ?? limit
          if first, let clause = window.lastIndex(where: { clauseEnds.contains($0) }),
            clause >= minimum {
            end = text.index(after: clause)
          } else if let boundary = window.lastIndex(where: { $0.isWhitespace }) {
            end = text.index(after: boundary)
          }
        }
        let chunk = start..<end
        let value = String(text[chunk])
        if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          var words: [NSRange] = []
          text.enumerateSubstrings(in: chunk, options: .byWords) { _, wordRange, _, _ in
            words.append(NSRange(wordRange, in: text))
          }
          sentences.append(SpeechSentence(text: value, range: NSRange(chunk, in: text), words: words))
        }
        start = end
      }
    }
    return sentences
  }
}

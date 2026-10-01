import Foundation

struct SpeechSentence {
  let text: String
  let range: NSRange
  let words: [NSRange]
}

enum SpeechTextPlan {
  // Short clauses bound first-audio latency and avoid Kokoro's 510-phoneme limit.
  // The original ranges survive splitting and numeric normalization in the frontend.
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
        let limit = text.index(start, offsetBy: 180, limitedBy: range.upperBound) ?? range.upperBound
        var end = limit
        if limit < range.upperBound,
          let boundary = text[start..<limit].lastIndex(where: { $0.isWhitespace }) {
          end = text.index(after: boundary)
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

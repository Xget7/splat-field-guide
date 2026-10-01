import Foundation

@main
struct SpeechPlanProbe {
  static func main() throws {
    let text = CommandLine.arguments[1]
    let plan = SpeechTextPlan.sentences(in: text).map { sentence -> [String: Any] in
      ["text": sentence.text, "location": sentence.range.location, "length": sentence.range.length,
       "words": sentence.words.map { ["location": $0.location, "length": $0.length] }]
    }
    let data = try JSONSerialization.data(withJSONObject: plan)
    print(String(decoding: data, as: UTF8.self))
  }
}

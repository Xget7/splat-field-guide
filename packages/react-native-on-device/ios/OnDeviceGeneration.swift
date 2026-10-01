import Foundation
import FoundationModels

enum OnDeviceGeneration {
  static func stream(session: LanguageModelSession, prompt: String,
    onPartial: (String) -> Void) async throws -> String {
    let stream = session.streamResponse(
      to: prompt, options: GenerationOptions(sampling: .greedy))
    var finalText: String?
    for try await snapshot in stream {
      try Task.checkCancellation()
      onPartial(snapshot.content)
      finalText = snapshot.content
    }
    try Task.checkCancellation()
    guard let finalText else {
      throw OnDeviceError(message: "Language model returned no response")
    }
    return finalText
  }

  static func readableError(_ error: Error) -> Error {
    if error is CancellationError { return OnDeviceError(message: "Language model cancelled") }
    guard let generationError = error as? LanguageModelSession.GenerationError else {
      return OnDeviceError(message: "Language model: \(String(describing: error))")
    }
    let name: String
    switch generationError {
    case .exceededContextWindowSize: name = "exceededContextWindowSize"
    case .assetsUnavailable: name = "assetsUnavailable"
    case .guardrailViolation: name = "guardrailViolation"
    case .unsupportedGuide: name = "unsupportedGuide"
    case .unsupportedLanguageOrLocale: name = "unsupportedLanguageOrLocale"
    case .decodingFailure: name = "decodingFailure"
    case .rateLimited: name = "rateLimited"
    case .concurrentRequests: name = "concurrentRequests"
    case .refusal: name = "refusal"
    @unknown default: name = "unknownGenerationError"
    }
    return OnDeviceError(message: "Language model \(name): \(generationError.localizedDescription)")
  }
}

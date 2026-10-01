import Foundation
import FoundationModels

enum OnDeviceGeneration {
  static func schema(fields: [(name: String, description: String, choices: [String])])
    throws -> GenerationSchema {
    let properties = fields.map { field in
      DynamicGenerationSchema.Property(
        name: field.name, description: field.description,
        schema: field.choices.isEmpty ? DynamicGenerationSchema(type: String.self)
          : DynamicGenerationSchema(name: field.name, anyOf: field.choices))
    }
    let root = DynamicGenerationSchema(name: "InstructorResponse", properties: properties)
    return try GenerationSchema(root: root, dependencies: [])
  }

  static func stream(session: LanguageModelSession, prompt: String, schema: GenerationSchema,
    onPartial: (String) -> Void) async throws -> String {
    let stream = session.streamResponse(
      to: prompt, schema: schema, options: GenerationOptions(samplingMode: .greedy))
    var finalJSON: String?
    for try await snapshot in stream {
      try Task.checkCancellation()
      let json = snapshot.content.jsonString
      onPartial(json)
      finalJSON = json
    }
    try Task.checkCancellation()
    guard let finalJSON else {
      throw OnDeviceError(message: "Language model returned no response")
    }
    return finalJSON
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

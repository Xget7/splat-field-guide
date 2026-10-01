import Foundation
import FoundationModels
import NitroModules

final class HybridLanguageModel: HybridLanguageModelSpec {
  private var running: (token: UUID, task: Task<Void, Never>)?
  private var warmed: (instructions: String, session: LanguageModelSession)?

  func availability() throws -> LanguageModelAvailability {
    switch SystemLanguageModel.default.availability {
    case .available: return .available
    case .unavailable(let reason):
      switch reason {
      case .deviceNotEligible: return .devicenoteligible
      case .appleIntelligenceNotEnabled: return .appleintelligencenotenabled
      case .modelNotReady: return .modelnotready
      @unknown default: return .unavailable
      }
    @unknown default: return .unavailable
    }
  }

  func prewarm(instructions: String) throws {
    DispatchQueue.main.async { self.warm(instructions: instructions) }
  }

  func respond(instructions: String, prompt: String, fields: [ResponseField],
    onPartial: @escaping (String) -> Void) throws -> Promise<String> {
    let promise = Promise<String>()
    DispatchQueue.main.async {
      self.running?.task.cancel()
      let token = UUID()
      let session = self.warmed?.instructions == instructions ? self.warmed!.session
        : LanguageModelSession(instructions: instructions)
      self.warmed = nil
      let task = Task { @MainActor in
        defer {
          if self.running?.token == token {
            self.running = nil
            self.warm(instructions: instructions)
          }
        }
        do {
          try Task.checkCancellation()
          let schema = try OnDeviceGeneration.schema(fields: fields.map {
            (name: $0.name, description: $0.description, choices: $0.choices)
          })
          let json = try await OnDeviceGeneration.stream(
            session: session, prompt: prompt, schema: schema, onPartial: onPartial)
          promise.resolve(withResult: json)
        } catch {
          let error = Task.isCancelled ? CancellationError() : error
          let failure = OnDeviceGeneration.readableError(error)
          OnDeviceLog.languageModel(failure)
          promise.reject(withError: failure)
        }
      }
      self.running = (token, task)
    }
    return promise
  }

  func cancel() throws {
    DispatchQueue.main.async { self.running?.task.cancel() }
  }

  private func warm(instructions: String) {
    let session = LanguageModelSession(instructions: instructions)
    session.prewarm()
    warmed = (instructions, session)
  }
}

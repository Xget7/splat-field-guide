// The harness substitutes only the external Nitro promise transport.
public enum SpeechVoice { case kokoro, system }

open class HybridSpeechOutputSpec {
  public init() {}
}

public final class Promise<Value> {
  public private(set) var settled = false
  public private(set) var result: Value?
  public init() {}
  public func resolve() { settled = true }
  public func resolve(withResult result: Value) { self.result = result; settled = true }
  public func reject(withError error: Error) { settled = true }
}

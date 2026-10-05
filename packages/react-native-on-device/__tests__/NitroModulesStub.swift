// The harness substitutes only the external Nitro promise transport.
open class HybridSpeechOutputSpec {
  public init() {}
}

public final class Promise<Value> {
  public private(set) var settled = false
  public init() {}
  public func resolve() { settled = true }
  public func reject(withError error: Error) { settled = true }
}

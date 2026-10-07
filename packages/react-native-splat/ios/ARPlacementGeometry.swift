import simd

enum ARPlacementGeometry {
  static let defaultScale: Float = 0.25
  static let minimumScale: Float = 0.1
  static let maximumScale: Float = 2

  static func scale(_ value: Float) -> Float {
    guard value.isFinite else { return defaultScale }
    return min(maximumScale, max(minimumScale, value))
  }

  static func elevation(_ value: Double) -> Float {
    guard value.isFinite else { return 0 }
    return Float(min(2, max(0, value)))
  }

  // Centre the footprint and keep its lowest point on the surface at every scale.
  static func supportOffset(minimum: SIMD3<Float>, maximum: SIMD3<Float>) -> SIMD3<Float>? {
    guard (0..<3).allSatisfy({ minimum[$0].isFinite && maximum[$0].isFinite && maximum[$0] > minimum[$0] })
    else { return nil }
    let centre = minimum + (maximum - minimum) / 2
    return -SIMD3(centre.x, minimum.y, centre.z)
  }
}

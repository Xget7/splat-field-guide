import Combine
import RealityKit
import UIKit
import simd

/// Turns a local USDZ model on a transparent background, as a live preview.
/// It renders only while in a window and keeps the loaded model for its return.
final class ModelNativeView: UIView {
  static let fullTurn = 360.0
  static let defaultPeriod = 24.0

  private enum Framing {
    /// Vertical field of view, in degrees.
    static let fieldOfView: Float = 30
    /// How far the camera looks down on the model, in radians.
    static let elevation: Float = 0.32
    /// Room around the model, relative to the distance that just fits it.
    static let margin: Float = 1.04
    /// The model is scaled to this reach so framing never depends on its units.
    static let reach: Float = 1
    /// Vertices sampled from the meshes to fit the camera, and turn angles checked.
    static let samples = 4000
    static let spinAngles = 24
    static let swayAngles = 9
    static let near: Float = 0.01
    static let far: Float = 100
  }

  private enum Lighting {
    static let keyIntensity: Float = 2400
    static let keyFrom: SIMD3<Float> = [-1.2, 2, 2]
  }

  var onLoaded: (Bool) -> Void = { _ in }

  private var modelPath = ""
  private var sweep = fullTurn
  private var period = defaultPeriod
  private var loadTask: Task<Void, Never>?
  private var model: Entity?
  /// A sample of the model's vertices around its turning axis, after scaling.
  private var outline: [SIMD3<Float>] = []
  private var announced = false
  private var dropped = false
  private var elapsed: TimeInterval = 0

  private let anchor = AnchorEntity(world: .zero)
  private let turntable = Entity()
  private let camera = PerspectiveCamera()
  private var arView: ARView?
  private var update: (any Cancellable)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isUserInteractionEnabled = false
    camera.camera.fieldOfViewInDegrees = Framing.fieldOfView
    camera.camera.near = Framing.near
    camera.camera.far = Framing.far
    let key = DirectionalLight()
    key.light.intensity = Lighting.keyIntensity
    key.look(at: .zero, from: Lighting.keyFrom, relativeTo: nil)
    anchor.addChild(turntable)
    anchor.addChild(camera)
    anchor.addChild(key)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  func configure(modelPath: String, sweep: Double, period: Double) {
    if sweep != self.sweep {
      self.sweep = sweep
      frameCamera()
    }
    self.period = max(period, 1)
    guard modelPath != self.modelPath, !dropped else { return }
    self.modelPath = modelPath
    load()
  }

  func shutdown() {
    dropped = true
    loadTask?.cancel()
    loadTask = nil
    stopRendering()
    model = nil
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { startRendering() } else { stopRendering() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    frameCamera()
  }

  private func load() {
    loadTask?.cancel()
    model?.removeFromParent()
    model = nil
    announced = false
    let url = modelPath.hasPrefix("/") ? URL(fileURLWithPath: modelPath)
      : Bundle.main.bundleURL.appendingPathComponent(modelPath)
    guard url.pathExtension.lowercased() == "usdz", FileManager.default.isReadableFile(atPath: url.path) else {
      onLoaded(false)
      return
    }
    let path = modelPath
    loadTask = Task { @MainActor [weak self] in
      do {
        let loaded = try await Entity(contentsOf: url)
        guard let self, !self.dropped, !Task.isCancelled, self.modelPath == path else { return }
        self.attach(loaded)
      } catch {
        guard let self, !self.dropped, !Task.isCancelled, self.modelPath == path else { return }
        self.onLoaded(false)
      }
    }
  }

  /// Centres the model on its bounds and scales it so it turns within a known reach.
  private func attach(_ loaded: Entity) {
    let bounds = loaded.visualBounds(relativeTo: nil)
    let half = bounds.extents / 2
    let footprint = max(simd_length(SIMD2(half.x, half.z)), half.y)
    let vertices = Self.vertices(of: loaded, limit: Framing.samples)
    guard footprint.isFinite, footprint > 0, !vertices.isEmpty else {
      onLoaded(false)
      return
    }
    let scale = Framing.reach / footprint
    loaded.position = -bounds.center
    let model = Entity()
    model.addChild(loaded)
    model.scale = SIMD3(repeating: scale)
    outline = vertices.map { ($0 - bounds.center) * scale }
    turntable.addChild(model)
    self.model = model
    frameCamera()
  }

  /// Up to about `limit` vertices of every mesh under the entity, in the space of its visual bounds.
  /// That space includes the root's own transform, which carries the file's units.
  private static func vertices(of root: Entity, limit: Int) -> [SIMD3<Float>] {
    var meshes: [(positions: [SIMD3<Float>], transform: simd_float4x4)] = []
    var pending = [root]
    while let entity = pending.popLast() {
      pending.append(contentsOf: entity.children)
      guard let component = entity.components[ModelComponent.self] else { continue }
      let placement = entity.transformMatrix(relativeTo: nil)
      let contents = component.mesh.contents
      for instance in contents.instances {
        guard let mesh = contents.models[instance.model] else { continue }
        for part in mesh.parts {
          meshes.append((part.positions.elements, placement * instance.transform))
        }
      }
    }
    let total = meshes.reduce(0) { $0 + $1.positions.count }
    let step = max(1, total / max(limit, 1))
    var sample: [SIMD3<Float>] = []
    sample.reserveCapacity(total / step + meshes.count)
    for mesh in meshes {
      for index in stride(from: 0, to: mesh.positions.count, by: step) {
        let point = mesh.transform * SIMD4(mesh.positions[index], 1)
        sample.append(SIMD3(point.x, point.y, point.z))
      }
    }
    return sample
  }

  private func startRendering() {
    guard arView == nil, !dropped else { return }
    let view = ARView(frame: bounds, cameraMode: .nonAR, automaticallyConfigureSession: false)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = .clear
    view.isOpaque = false
    view.environment.background = .color(.clear)
    view.renderOptions.formUnion([.disableMotionBlur, .disableDepthOfField, .disableCameraGrain])
    view.isUserInteractionEnabled = false
    addSubview(view)
    view.scene.addAnchor(anchor)
    update = view.scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
      let delta = event.deltaTime
      MainActor.assumeIsolated { self?.advance(by: delta) }
    }
    arView = view
    frameCamera()
  }

  private func stopRendering() {
    update?.cancel()
    update = nil
    arView?.scene.removeAnchor(anchor)
    arView?.removeFromSuperview()
    arView = nil
  }

  /// Places the camera, slightly raised, just far enough to keep the model in view at every angle it turns through.
  private func frameCamera() {
    guard bounds.width > 0, bounds.height > 0, !outline.isEmpty else { return }
    let tanVertical = tan(Framing.fieldOfView * .pi / 360)
    let tanHorizontal = tanVertical * Float(bounds.width / bounds.height)
    let toEye = SIMD3<Float>(0, sin(Framing.elevation), cos(Framing.elevation))
    let up = SIMD3<Float>(0, cos(Framing.elevation), -sin(Framing.elevation))
    var distance: Float = 0
    for angle in turnAngles() {
      let turn = simd_quatf(angle: angle, axis: [0, 1, 0])
      for vertex in outline {
        let point = turn.act(vertex)
        let depth = simd_dot(point, toEye)
        distance = max(distance,
          depth + abs(point.x) / tanHorizontal,
          depth + abs(simd_dot(point, up)) / tanVertical)
      }
    }
    camera.look(at: .zero, from: toEye * distance * Framing.margin, relativeTo: anchor)
  }

  /// The angles the model passes through, sampled evenly.
  private func turnAngles() -> [Float] {
    if sweep >= Self.fullTurn {
      return (0..<Framing.spinAngles).map { 2 * .pi * Float($0) / Float(Framing.spinAngles) }
    }
    let reach = Float(sweep / 2 * .pi / 180)
    return (0..<Framing.swayAngles).map {
      -reach + 2 * reach * Float($0) / Float(Framing.swayAngles - 1)
    }
  }

  private func advance(by delta: TimeInterval) {
    if !UIAccessibility.isReduceMotionEnabled { elapsed += delta }
    let phase = 2 * Double.pi * elapsed / period
    let angle = sweep >= Self.fullTurn ? phase : sweep / 2 * .pi / 180 * sin(phase)
    turntable.orientation = simd_quatf(angle: Float(angle), axis: [0, 1, 0])
    // The model draws in this frame, so the preview can now show it.
    if model != nil, !announced {
      announced = true
      onLoaded(true)
    }
  }
}

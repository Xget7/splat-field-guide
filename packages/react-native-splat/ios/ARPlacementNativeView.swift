import ARKit
import AVFoundation
import RealityKit
import UIKit
import simd

/// The camera, equipment and anchor live together on the main queue.
final class ARPlacementNativeView: UIView, ARSessionDelegate, UIGestureRecognizerDelegate {
  private var arView: ARView?
  private var equipment: Entity?
  private var assembly: ARPlacementAssembly?
  private var assemblyContent: Entity?
  private var anchor: AnchorEntity?
  private var sessionAnchor: ARAnchor?
  private var modelPath = ""
  private var loadTask: Task<Void, Never>?
  private var loadGeneration = 0
  private var loadFailure: String?
  private var scale = ARPlacementGeometry.defaultScale
  private var elevation: Float = 0
  private var scaleRequest: Double = -1
  private var placementRequest: Double = 0
  private var resetRequest: Double = 0
  private var assemblyStep: Double = -1
  private var assemblyRequest: Double = 0
  private var assemblyOrder: [String] = []
  private var exploded = true
  private var yaw: Float = 0
  private var pinchStart = ARPlacementGeometry.defaultScale
  private var rotationStart: Float = 0
  private var requestingPermission = false
  private var running = false
  private var interrupted = false
  private var failed = false
  private var dropped = false
  private var appActive = UIApplication.shared.applicationState == .active
  private var observers: [NSObjectProtocol] = []
  private var lastSample: TimeInterval = 0
  private static let sampleInterval: TimeInterval = 0.1
  private var handler: (ARPlacementEvent) -> Void = { _ in }
  private var lastEvent: ARPlacementEvent?
  private var assemblyHandler: (ARAssemblyEvent) -> Void = { _ in }
  private var lastAssemblyEvent: ARAssemblyEvent?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .black
    let notifications = NotificationCenter.default
    observers = [
      notifications.addObserver(forName: UIApplication.willResignActiveNotification,
        object: nil, queue: .main) { [weak self] _ in
          self?.appActive = false
          self?.reconcile()
        },
      notifications.addObserver(forName: UIApplication.didBecomeActiveNotification,
        object: nil, queue: .main) { [weak self] _ in
          self?.appActive = true
          self?.reconcile()
        },
    ]
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView?.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reconcile()
  }

  func setEventHandler(_ handler: @escaping (ARPlacementEvent) -> Void) {
    self.handler = handler
    if let lastEvent { handler(lastEvent) }
  }

  func setAssemblyEventHandler(_ handler: ((ARAssemblyEvent) -> Void)?) {
    assemblyHandler = handler ?? { _ in }
    if let lastAssemblyEvent { assemblyHandler(lastAssemblyEvent) }
  }

  func configure(modelPath: String, scale: Double, scaleRequest: Double,
    placementRequest: Double, resetRequest: Double, assemblyStep: Double? = nil, exploded: Bool? = nil,
    assemblyOrder: [String]? = nil, assemblyRequest: Double? = nil, elevation: Double? = nil) {
    guard !dropped else { return }
    self.elevation = ARPlacementGeometry.elevation(elevation ?? 0)
    equipment?.position.y = self.elevation
    if self.modelPath != modelPath {
      self.modelPath = modelPath
      loadGeneration += 1
      loadTask?.cancel()
      loadTask = nil
      removePlacement()
      equipment = nil
      assembly = nil
      assemblyContent = nil
      lastAssemblyEvent = nil
      loadFailure = nil
    }
    let order = assemblyOrder ?? []
    if self.assemblyOrder != order {
      self.assemblyOrder = order
      assembly?.apply(assembledCount: Int.max, exploded: false, animated: false)
      if let assemblyContent { assembly = ARPlacementAssembly(content: assemblyContent, order: order) }
      lastAssemblyEvent = nil
    }
    self.assemblyStep = assemblyStep ?? -1
    self.assemblyRequest = assemblyRequest ?? 0
    self.exploded = exploded ?? true
    applyAssembly(animated: anchor != nil && running)
    if self.scaleRequest != scaleRequest {
      self.scaleRequest = scaleRequest
      self.scale = ARPlacementGeometry.scale(Float(scale))
      equipment?.scale = SIMD3(repeating: self.scale)
    }
    if self.resetRequest != resetRequest {
      self.resetRequest = resetRequest
      removePlacement()
    }
    reconcile()
    if self.placementRequest != placementRequest {
      self.placementRequest = placementRequest
      place()
    }
  }

  func shutdown() {
    guard !dropped else { return }
    assembly?.onChange = nil
    assembly?.cancel()
    dropped = true
    loadGeneration += 1
    loadTask?.cancel()
    loadTask = nil
    handler = { _ in }
    assemblyHandler = { _ in }
    lastAssemblyEvent = nil
    arView?.session.pause()
    arView?.session.delegate = nil
    arView?.scene.anchors.removeAll()
    arView?.removeFromSuperview()
    arView = nil
    equipment = nil
    assembly = nil
    assemblyContent = nil
    anchor = nil
    sessionAnchor = nil
    running = false
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
  }

  private func reconcile() {
    guard !dropped else { return }
    #if targetEnvironment(simulator)
    emit(.unsupported, "Use a physical iPhone or iPad to place the engine in your space.")
    return
    #else
    guard ARWorldTrackingConfiguration.isSupported else {
      emit(.unsupported, "This device does not support AR placement.")
      return
    }
    guard window != nil, appActive, !interrupted else {
      assembly?.cancel()
      arView?.session.pause()
      running = false
      equipment?.isEnabled = false
      emit(.paused, "AR is paused.")
      return
    }
    guard !failed else { return }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .notDetermined:
      guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
        emit(.error, "Camera access is not configured in this build.")
        return
      }
      emit(.requestingPermission, "Allow camera access to view the engine in your space.")
      guard !requestingPermission else { return }
      requestingPermission = true
      AVCaptureDevice.requestAccess(for: .video) { [weak self] _ in
        DispatchQueue.main.async {
          self?.requestingPermission = false
          self?.reconcile()
        }
      }
      return
    case .authorized: break
    default:
      assembly?.cancel()
      arView?.session.pause()
      running = false
      emit(.permissionDenied, "Enable camera access in Settings to use AR.")
      return
    }
    if let loadFailure {
      emit(.error, loadFailure)
      return
    }
    guard equipment != nil else {
      loadEquipment()
      return
    }
    startSession()
    if let frame = arView?.session.currentFrame { update(frame) }
    #endif
  }

  private func loadEquipment() {
    emit(.loading, "Loading the engine capture.")
    guard loadTask == nil else { return }
    let url = modelPath.hasPrefix("/") ? URL(fileURLWithPath: modelPath)
      : Bundle.main.bundleURL.appendingPathComponent(modelPath)
    guard url.pathExtension.lowercased() == "usdz", FileManager.default.isReadableFile(atPath: url.path) else {
      loadFailure = "The engine capture is missing from this build."
      emit(.error, loadFailure!)
      return
    }
    let generation = loadGeneration
    loadTask = Task { @MainActor [weak self] in
      do {
        let capture = try await Entity(contentsOf: url)
        guard let self, !self.dropped, !Task.isCancelled, self.loadGeneration == generation else { return }
        let content = Entity()
        content.addChild(capture)
        let bounds = content.visualBounds(relativeTo: content)
        guard let offset = ARPlacementGeometry.supportOffset(minimum: bounds.min, maximum: bounds.max) else {
          throw NSError(domain: "ARPlacementView", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "The capture has no finite volume."])
        }
        content.position = offset
        let equipment = Entity()
        equipment.addChild(content)
        equipment.scale = SIMD3(repeating: self.scale)
        equipment.position.y = self.elevation
        self.equipment = equipment
        self.assemblyContent = content
        self.assembly = ARPlacementAssembly(content: content, order: self.assemblyOrder)
        self.applyAssembly(animated: false)
        self.loadTask = nil
        self.reconcile()
      } catch {
        guard let self, !self.dropped, !Task.isCancelled, self.loadGeneration == generation else { return }
        NSLog("ARPlacementView: capture loading failed: %@", error.localizedDescription)
        self.loadTask = nil
        self.loadFailure = "The engine capture could not be loaded. Reopen AR to try again."
        self.emit(.error, self.loadFailure!)
      }
    }
  }

  private func applyAssembly(animated: Bool) {
    guard let assembly else { return }
    let enabled = assemblyStep.isFinite && assemblyStep >= 0
    let count = enabled ? Int(min(Double(assembly.parts.count), assemblyStep)) : assembly.parts.count
    assembly.onChange = { [weak self, weak assembly] snapshot in
      guard let self, let assembly, !self.dropped, self.assembly === assembly else { return }
      let phase: ARAssemblyPhase
      switch snapshot.phase {
      case "assembling": phase = .assembling
      case "separating": phase = .separating
      case "previewing": phase = .previewing
      default: phase = .idle
      }
      let event = ARAssemblyEvent(parts: assembly.parts.map { ARAssemblyPart(id: $0.id, label: $0.label) },
        assembledCount: Double(snapshot.assembledCount), requestId: snapshot.requestId, phase: phase)
      self.lastAssemblyEvent = event
      self.assemblyHandler(event)
    }
    assembly.apply(assembledCount: count, exploded: enabled && exploded,
      animated: animated, requestId: assemblyRequest, scene: arView?.scene)
  }

  private func startSession() {
    guard !running else { return }
    let view: ARView
    if let arView { view = arView }
    else {
      view = ARView(frame: bounds, cameraMode: .ar, automaticallyConfigureSession: false)
      arView = view
      insertSubview(view, at: 0)
      view.session.delegateQueue = .main
      view.session.delegate = self
      let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:)))
      let rotation = UIRotationGestureRecognizer(target: self, action: #selector(rotate(_:)))
      pinch.delegate = self
      rotation.delegate = self
      view.addGestureRecognizer(pinch)
      view.addGestureRecognizer(rotation)
    }
    let configuration = ARWorldTrackingConfiguration()
    configuration.planeDetection = .horizontal
    configuration.environmentTexturing = .automatic
    view.session.run(configuration)
    running = true
    lastSample = 0
    emit(.searching, "Move slowly over a table or the floor to find a flat surface.")
  }

  private func surface() -> ARRaycastResult? {
    guard let arView, !arView.bounds.isEmpty else { return nil }
    return arView.raycast(from: CGPoint(x: arView.bounds.midX, y: arView.bounds.midY),
      allowing: .existingPlaneGeometry, alignment: .horizontal).first
  }

  private func place() {
    guard running, appActive, !interrupted, let arView, let equipment,
      case .normal = arView.session.currentFrame?.camera.trackingState,
      let result = surface(), result.anchor is ARPlaneAnchor
    else {
      if running { emit(.searching, "Aim the centre at a detected flat surface before placing.") }
      return
    }
    removePlacement()
    let sessionAnchor = ARAnchor(name: "field-guide-equipment", transform: result.worldTransform)
    arView.session.add(anchor: sessionAnchor)
    let anchor = AnchorEntity(anchor: sessionAnchor)
    anchor.addChild(equipment)
    arView.scene.addAnchor(anchor)
    self.sessionAnchor = sessionAnchor
    self.anchor = anchor
    // Face the capture toward the person while keeping its base horizontal.
    let camera = arView.cameraTransform.translation
    let origin = result.worldTransform.columns.3
    yaw = atan2(camera.x - origin.x, camera.z - origin.z)
    equipment.orientation = simd_quatf(angle: yaw, axis: SIMD3(0, 1, 0))
    equipment.isEnabled = true
    emit(.placed, "Walk around the engine. Pinch to resize or twist with two fingers to turn it.")
  }

  private func removePlacement() {
    assembly?.cancel()
    equipment?.removeFromParent()
    if let anchor { arView?.scene.removeAnchor(anchor) }
    if let sessionAnchor { arView?.session.remove(anchor: sessionAnchor) }
    anchor = nil
    sessionAnchor = nil
    yaw = 0
    equipment?.orientation = simd_quatf()
  }

  private func update(_ frame: ARFrame) {
    guard running, !dropped, appActive, !interrupted else { return }
    guard case .normal = frame.camera.trackingState else {
      assembly?.cancel()
      equipment?.isEnabled = false
      emit(.limited, "Move slowly and keep the surface in view to restore tracking.")
      return
    }
    equipment?.isEnabled = true
    if anchor != nil {
      emit(.placed, "Walk around the engine. Pinch to resize or twist with two fingers to turn it.")
    } else if surface() != nil {
      emit(.ready, "Surface found. Aim the centre where you want the engine and tap Place engine.")
    } else {
      emit(.searching, "Move slowly over a table or the floor to find a flat surface.")
    }
  }

  @objc private func pinch(_ gesture: UIPinchGestureRecognizer) {
    guard anchor != nil, running, equipment?.isEnabled == true else { return }
    if gesture.state == .began { pinchStart = scale }
    scale = ARPlacementGeometry.scale(pinchStart * Float(gesture.scale))
    equipment?.scale = SIMD3(repeating: scale)
    if let frame = arView?.session.currentFrame { update(frame) }
  }

  @objc private func rotate(_ gesture: UIRotationGestureRecognizer) {
    guard anchor != nil, running, equipment?.isEnabled == true else { return }
    if gesture.state == .began { rotationStart = yaw }
    yaw = rotationStart - Float(gesture.rotation)
    equipment?.orientation = simd_quatf(angle: yaw, axis: SIMD3(0, 1, 0))
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard frame.timestamp - lastSample >= Self.sampleInterval else { return }
    lastSample = frame.timestamp
    update(frame)
  }

  func sessionWasInterrupted(_ session: ARSession) {
    interrupted = true
    reconcile()
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    interrupted = false
    // An interruption can invalidate the old world origin; ask for a fresh placement.
    removePlacement()
    reconcile()
  }

  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    guard let sessionAnchor, anchors.contains(where: { $0.identifier == sessionAnchor.identifier }) else { return }
    removePlacement()
    if let frame = session.currentFrame { update(frame) }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    guard !dropped else { return }
    failed = true
    running = false
    assembly?.cancel()
    session.pause()
    equipment?.isEnabled = false
    NSLog("ARPlacementView: session failed: %@", error.localizedDescription)
    emit(.error, "AR could not continue. Reopen AR to try again.")
  }

  private func emit(_ state: ARPlacementState, _ message: String) {
    guard !dropped else { return }
    let event = ARPlacementEvent(state: state, message: message, scale: Double(scale), placed: anchor != nil)
    if let lastEvent, lastEvent.state == state, lastEvent.message == message,
      lastEvent.scale == event.scale, lastEvent.placed == event.placed { return }
    lastEvent = event
    handler(event)
  }
}

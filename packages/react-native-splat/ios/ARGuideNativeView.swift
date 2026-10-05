import ARKit
import AVFoundation
import RealityKit
import UIKit
import simd

private struct ARGuideLandmark: Decodable {
  let id: String
  let label: String
  let position: [Float]
  let color: [Float]
}

private struct ARGuideRegistration: Decodable {
  let schemaVersion: Int
  let referenceFromPack: [[Float]]
  let landmarks: [ARGuideLandmark]

  func validatedTransform() throws -> simd_float4x4 {
    guard schemaVersion == 1, referenceFromPack.count == 4,
      referenceFromPack.allSatisfy({ $0.count == 4 && $0.allSatisfy(\.isFinite) })
    else { throw ARGuideAssetError.invalidLandmarks("Invalid schemaVersion or referenceFromPack matrix.") }
    let rows = referenceFromPack
    let matrix = simd_float4x4(
      SIMD4(rows[0][0], rows[1][0], rows[2][0], rows[3][0]),
      SIMD4(rows[0][1], rows[1][1], rows[2][1], rows[3][1]),
      SIMD4(rows[0][2], rows[1][2], rows[2][2], rows[3][2]),
      SIMD4(rows[0][3], rows[1][3], rows[2][3], rows[3][3]))
    guard abs(rows[3][0]) < 0.0001, abs(rows[3][1]) < 0.0001,
      abs(rows[3][2]) < 0.0001, abs(rows[3][3] - 1) < 0.0001,
      abs(simd_determinant(matrix)) > 0.000001
    else { throw ARGuideAssetError.invalidLandmarks("referenceFromPack must be affine and invertible.") }
    guard landmarks.count == 4, Set(landmarks.map(\.id)).count == 4,
      landmarks.allSatisfy({
        !$0.id.isEmpty && !$0.label.isEmpty && $0.position.count == 3
          && $0.position.allSatisfy(\.isFinite) && $0.color.count == 3
          && $0.color.allSatisfy { $0.isFinite && (0...1).contains($0) }
      })
    else { throw ARGuideAssetError.invalidLandmarks("Expected four unique finite points with RGB values in 0–1.") }
    return matrix
  }
}

private enum ARGuideAssetError: LocalizedError {
  case missingReference, missingLandmarks
  case invalidReference(String), invalidLandmarks(String)
  var errorDescription: String? {
    switch self {
    case .missingReference: return "The engine reference is not included in this build yet."
    case .missingLandmarks: return "The engine guide points are not included in this build yet."
    case .invalidReference: return "The engine reference could not be loaded."
    case .invalidLandmarks: return "The engine guide points could not be loaded."
    }
  }
}

private struct ARGuideAssets {
  let reference: ARReferenceObject
  let registration: ARGuideRegistration
  let referenceFromPack: simd_float4x4
}

/// Owns a single AR session. All state, UIKit and delegate work stays on the main queue.
final class ARGuideNativeView: UIView, ARSessionDelegate {
  private var arView: ARView?
  private var assets: ARGuideAssets?
  private var referencePath = ""
  private var landmarksPath = ""
  private var loadGeneration = 0
  private var loading = false
  private var loadFailure: String?
  private var requestingPermission = false
  private var interrupted = false
  private var running = false
  private var dropped = false
  private var appActive = UIApplication.shared.applicationState == .active
  private var observers: [NSObjectProtocol] = []
  private var anchorID: UUID?
  private var anchorEntity: AnchorEntity?
  private var eventHandler: (ARTrackingEvent) -> Void = { _ in }
  private var lastEvent: ARTrackingEvent?
  private var currentState: ARTrackingState = .loading
  private var currentMessage = "Preparing camera."
  private var torchRequested = false
  private var captureDevice: AVCaptureDevice?
  private var torchObservers: [NSKeyValueObservation] = []
  private var torchError: String?
  // Opt-in diagnostics stream metadata only, never camera images or audio.
  #if DEBUG
  private let diagnosticsEnabled =
    ProcessInfo.processInfo.environment["FIELD_GUIDE_AR_DIAGNOSTICS"] == "1"
  #else
  private let diagnosticsEnabled = false
  #endif
  private var diagnosticSessionStart: TimeInterval?
  private var diagnosticWindowStart: TimeInterval?
  private var diagnosticFrameCount = 0
  private var diagnosticFirstDetection: TimeInterval?
  private var telemetry: ARTrackingTelemetry?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .black
    trace("ready", ["samplingHz": 1, "modelConfidenceAvailable": false])
    let center = NotificationCenter.default
    observers = [
      center.addObserver(
        forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.appActive = false
        self?.reconcile()
      },
      center.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        self?.appActive = true
        self?.reconcile()
      },
    ]
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView?.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reconcile()
  }

  func setEventHandler(_ handler: @escaping (ARTrackingEvent) -> Void) {
    eventHandler = handler
    if let lastEvent { handler(lastEvent) }
  }

  func configure(referencePath: String, landmarksPath: String, torchEnabled: Bool) {
    guard !dropped else { return }
    if self.referencePath != referencePath || self.landmarksPath != landmarksPath {
      pause()
      clearAnchor()
      loadGeneration += 1
      loading = false
      assets = nil
      loadFailure = nil
      lastEvent = nil
      self.referencePath = referencePath
      self.landmarksPath = landmarksPath
    }
    if torchRequested != torchEnabled {
      torchRequested = torchEnabled
      // A rejected toggle still needs a reply when the hardware state and error are unchanged.
      lastEvent = nil
    }
    reconcile()
  }

  func shutdown() {
    guard !dropped else { return }
    trace("closed")
    dropped = true
    loadGeneration += 1
    pause()
    clearAnchor()
    arView?.session.delegate = nil
    arView?.removeFromSuperview()
    arView = nil
    assets = nil
    torchObservers.removeAll()
    captureDevice = nil
    observers.forEach(NotificationCenter.default.removeObserver)
    observers.removeAll()
    eventHandler = { _ in }
  }

  private func reconcile() {
    guard !dropped else { return }
    guard #available(iOS 27.0, *) else {
      emit(.unsupported, "This AR guide requires an iPhone running iOS 27.")
      return
    }
    #if targetEnvironment(simulator)
      emit(.unsupported, "Engine recognition requires a physical iPhone running iOS 27.")
      return
    #else
      guard ARWorldTrackingConfiguration.isSupported else {
        emit(.unsupported, "This device does not support AR tracking.")
        return
      }
      guard window != nil && appActive else {
        pause()
        emit(.paused, "AR is paused.")
        return
      }
      guard !referencePath.isEmpty && !landmarksPath.isEmpty else {
        emit(.loading, "Waiting for the engine guide files.")
        return
      }
      if let loadFailure {
        emit(.error, loadFailure)
        return
      }
      guard let assets else {
        if !loading { loadAssets() }
        return
      }
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized:
        start(using: assets)
      case .notDetermined:
        guard !requestingPermission else { return }
        guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
          NSLog("ARGuideView: missing NSCameraUsageDescription")
          emit(.error, "Camera access is not configured in this build.")
          return
        }
        requestingPermission = true
        emit(.requestingPermission, "Allow camera access to recognize the engine.")
        AVCaptureDevice.requestAccess(for: .video) { [weak self] _ in
          DispatchQueue.main.async {
            self?.requestingPermission = false
            self?.reconcile()
          }
        }
      case .denied, .restricted:
        pause()
        emit(.permissionDenied, "Camera access is disabled. Enable it in Settings to use AR.")
      @unknown default:
        emit(.error, "Camera access could not be checked.")
      }
    #endif
  }

  private func loadAssets() {
    loading = true
    emit(.loading, "Loading the engine reference and guide points.")
    let generation = loadGeneration
    let referenceURL = Self.localURL(referencePath)
    let landmarksURL = Self.localURL(landmarksPath)
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let result = Result { try Self.readAssets(referenceURL, landmarksURL) }
      DispatchQueue.main.async {
        guard let self, !self.dropped, self.loadGeneration == generation else { return }
        self.loading = false
        switch result {
        case .success(let assets): self.assets = assets
        case .failure(let error):
          NSLog("ARGuideView: asset loading failed: %@", String(describing: error))
          self.trace("error", ["operation": "load", "detail": String(describing: error)])
          self.loadFailure = (error as? ARGuideAssetError)?.errorDescription
            ?? "The engine guide files could not be loaded."
        }
        self.reconcile()
      }
    }
  }

  private static func localURL(_ path: String) -> URL {
    if path.hasPrefix("file://"), let url = URL(string: path), url.isFileURL { return url }
    if path.hasPrefix("/") { return URL(fileURLWithPath: path) }
    return (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent(path)
  }

  private static func readAssets(_ referenceURL: URL, _ landmarksURL: URL) throws -> ARGuideAssets {
    guard referenceURL.pathExtension.lowercased() == "referenceobject" else {
      throw ARGuideAssetError.invalidReference("Expected a .referenceobject archive.")
    }
    guard FileManager.default.isReadableFile(atPath: referenceURL.path) else {
      throw ARGuideAssetError.missingReference
    }
    guard FileManager.default.isReadableFile(atPath: landmarksURL.path) else {
      throw ARGuideAssetError.missingLandmarks
    }
    let registration: ARGuideRegistration
    do {
      registration = try JSONDecoder().decode(
        ARGuideRegistration.self, from: Data(contentsOf: landmarksURL))
    } catch { throw ARGuideAssetError.invalidLandmarks(error.localizedDescription) }
    let transform = try registration.validatedTransform()
    let reference: ARReferenceObject
    do { reference = try ARReferenceObject(archiveURL: referenceURL) }
    catch { throw ARGuideAssetError.invalidReference(error.localizedDescription) }
    reference.name = "field-guide-engine"
    return ARGuideAssets(reference: reference, registration: registration, referenceFromPack: transform)
  }

  private func start(using assets: ARGuideAssets) {
    guard !running else {
      applyTorch()
      emit(currentState, currentMessage)
      return
    }
    let view: ARView
    if let arView {
      view = arView
    } else {
      view = ARView(frame: bounds, cameraMode: .ar, automaticallyConfigureSession: false)
      view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(view)
      arView = view
    }
    clearAnchor()
    let config = ARWorldTrackingConfiguration()
    config.detectionObjects = [assets.reference]
    torchObservers.removeAll()
    captureDevice = AVCaptureDevice.default(
      config.videoFormat.captureDeviceType, for: .video,
      position: config.videoFormat.captureDevicePosition)
    if let device = captureDevice {
      torchObservers = [
        device.observe(\.isTorchAvailable, options: [.new]) { [weak self] _, _ in
          DispatchQueue.main.async {
            self?.applyTorch()
            self?.publishTorch()
          }
        },
        device.observe(\.isTorchActive, options: [.new]) { [weak self] _, _ in
          DispatchQueue.main.async { self?.publishTorch() }
        },
      ]
    }
    view.session.delegate = self
    view.session.delegateQueue = .main
    interrupted = false
    running = true
    diagnosticSessionStart = CACurrentMediaTime()
    diagnosticWindowStart = nil
    diagnosticFrameCount = 0
    diagnosticFirstDetection = nil
    telemetry = nil
    view.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    applyTorch()
    trace("sessionStarted", ["detectionReferences": config.detectionObjects.count,
      "referenceName": assets.reference.name ?? "", "recognitionMode": "detectionObjects"])
    emit(.searching, "Point at the engine and move the phone slowly to recognize it.")
  }

  private func pause() {
    if running { trace("paused") }
    running = false
    telemetry = nil
    applyTorch()
    arView?.session.pause()
    anchorEntity?.isEnabled = false
  }

  private func applyTorch() {
    guard let device = captureDevice, device.hasTorch else { return }
    let turnOn = running && !interrupted && torchRequested && device.isTorchAvailable
    let mode: AVCaptureDevice.TorchMode = turnOn ? .on : .off
    guard device.isTorchModeSupported(mode), device.torchMode != mode else { return }
    do {
      try device.lockForConfiguration()
      defer { device.unlockForConfiguration() }
      if turnOn { try device.setTorchModeOn(level: 0.5) }
      else { device.torchMode = .off }
      torchError = nil
    } catch {
      torchError = "The flash could not be changed. Try again."
      trace("torchError", ["detail": error.localizedDescription])
    }
  }

  private func publishTorch() {
    guard !dropped else { return }
    emit(currentState, currentMessage)
  }

  private func clearAnchor() {
    if let anchorEntity { arView?.scene.removeAnchor(anchorEntity) }
    anchorEntity = nil
    anchorID = nil
  }

  @available(iOS 27.0, *)
  private func update(_ anchor: ARObjectAnchor, camera: ARCamera?) {
    guard running, !interrupted, let assets, let arView else { return }
    guard anchor.referenceObject.name == assets.reference.name else { return }
    if anchorID == nil {
      if diagnosticFirstDetection == nil, let diagnosticSessionStart {
        diagnosticFirstDetection = CACurrentMediaTime() - diagnosticSessionStart
      }
      let root = AnchorEntity(anchor: anchor)
      let pack = Entity()
      pack.transform = Transform(matrix: assets.referenceFromPack)
      for landmark in assets.registration.landmarks {
        let color = UIColor(
          red: CGFloat(landmark.color[0]), green: CGFloat(landmark.color[1]),
          blue: CGFloat(landmark.color[2]), alpha: 1)
        let pin = ModelEntity(
          mesh: .generateSphere(radius: 0.012), materials: [UnlitMaterial(color: color)])
        pin.name = landmark.id
        pin.position = SIMD3(landmark.position[0], landmark.position[1], landmark.position[2])
        pack.addChild(pin)
      }
      root.addChild(pack)
      root.isEnabled = false
      arView.scene.addAnchor(root)
      anchorID = anchor.identifier
      anchorEntity = root
    }
    guard anchor.identifier == anchorID else { return }
    let cameraNormal: Bool
    if let camera, case .normal = camera.trackingState { cameraNormal = true }
    else { cameraNormal = false }
    anchorEntity?.isEnabled = anchor.isTracked && cameraNormal
    if anchor.isTracked && cameraNormal {
      emit(.tracking, "Engine detected. Check that the four guide points align.")
    } else {
      emit(.limited, "Tracking is limited. Point at the engine in good lighting.")
    }
  }

  func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
    guard running, #available(iOS 27.0, *) else { return }
    for case let anchor as ARObjectAnchor in anchors {
      trace("objectAnchorAdded", ["referenceName": anchor.referenceObject.name ?? "",
        "matchesReference": anchor.referenceObject.name == assets?.reference.name,
        "isTracked": anchor.isTracked])
      update(anchor, camera: session.currentFrame?.camera)
    }
  }

  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
    guard running, #available(iOS 27.0, *) else { return }
    for case let anchor as ARObjectAnchor in anchors {
      update(anchor, camera: session.currentFrame?.camera)
    }
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard running, !interrupted, #available(iOS 27.0, *) else { return }
    if let anchorID, !frame.anchors.contains(where: { $0.identifier == anchorID }) {
      anchorEntity?.isEnabled = false
      emit(.limited, "Tracking is limited. Point at the engine in good lighting.")
    }
    for case let anchor as ARObjectAnchor in frame.anchors {
      update(anchor, camera: frame.camera)
    }
    if anchorID == nil, case .limited = frame.camera.trackingState {
      emit(.limited, "Move the phone slowly to establish tracking.")
    } else if anchorID == nil, case .normal = frame.camera.trackingState {
      emit(.searching, "Point at the engine and move the phone slowly to recognize it.")
    } else if case .notAvailable = frame.camera.trackingState {
      anchorEntity?.isEnabled = false
      emit(.limited, "AR tracking is temporarily unavailable.")
    }
    sample(frame)
  }

  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    guard running, anchors.contains(where: { $0.identifier == anchorID }) else { return }
    clearAnchor()
    emit(.searching, "Searching for the engine again.")
  }

  func sessionWasInterrupted(_ session: ARSession) {
    guard running else { return }
    interrupted = true
    telemetry = nil
    applyTorch()
    anchorEntity?.isEnabled = false
    emit(.limited, "AR tracking was interrupted.")
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    pause()
    reconcile()
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    guard running else { return }
    pause()
    NSLog("ARGuideView: session failed: %@", error.localizedDescription)
    trace("error", ["operation": "session", "detail": error.localizedDescription])
    let message = "AR tracking could not continue. Reopen the guide to try again."
    loadFailure = message
    emit(.error, message)
  }

  private func emit(_ state: ARTrackingState, _ message: String) {
    currentState = state
    currentMessage = message
    let event = ARTrackingEvent(
      state: state, message: message,
      torchAvailable: running && !interrupted && (captureDevice?.hasTorch ?? false)
        && (captureDevice?.isTorchAvailable ?? false),
      torchEnabled: captureDevice?.isTorchActive ?? false, torchError: torchError,
      referenceLoaded: assets != nil, telemetry: telemetry)
    if let lastEvent, lastEvent.state == event.state, lastEvent.message == event.message,
      lastEvent.torchAvailable == event.torchAvailable, lastEvent.torchEnabled == event.torchEnabled,
      lastEvent.torchError == event.torchError, lastEvent.referenceLoaded == event.referenceLoaded,
      lastEvent.telemetry?.sampleTimestamp == event.telemetry?.sampleTimestamp { return }
    lastEvent = event
    #if DEBUG
    let reference = assets?.reference
    trace("state", ["state": state.stringValue, "message": message,
      "torchAvailable": event.torchAvailable, "torchEnabled": event.torchEnabled,
      "torchError": event.torchError ?? "", "referenceLoaded": assets != nil,
      "referenceCenter": reference.map { [$0.center.x, $0.center.y, $0.center.z] } ?? [],
      "referenceExtent": reference.map { [$0.extent.x, $0.extent.y, $0.extent.z] } ?? [],
      "referenceScale": reference.map { [$0.scale.x, $0.scale.y, $0.scale.z] } ?? []])
    #endif
    eventHandler(event)
  }

  private func trace(_ event: String, _ fields: [String: Any] = [:]) {
    guard diagnosticsEnabled else { return }
    var record = fields
    record["event"] = event
    record["timestamp"] = Date().timeIntervalSince1970
    record["referenceLoaded"] = assets != nil
    guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8),
      let line = "[ARGuide] \(json)\n".data(using: .utf8)
    else { return }
    try? FileHandle.standardError.write(contentsOf: line)
  }

  @available(iOS 27.0, *)
  private func sample(_ frame: ARFrame) {
    // The HUD samples metadata on-device even when console diagnostics are disabled.
    // Keep camera FPS separate from model inference rate/confidence.
    guard let windowStart = diagnosticWindowStart else {
      diagnosticWindowStart = frame.timestamp
      diagnosticFrameCount = 0
      return
    }
    diagnosticFrameCount += 1
    let interval = frame.timestamp - windowStart
    guard interval >= 1 else { return }
    let allObjects = frame.anchors.compactMap { $0 as? ARObjectAnchor }
    let objects = allObjects.filter {
      $0.referenceObject.name == assets?.reference.name
    }
    let cameraState: ARCameraTracking
    switch frame.camera.trackingState {
    case .normal: cameraState = .normal
    case .notAvailable: cameraState = .notavailable
    case .limited(let reason):
      switch reason {
      case .initializing: cameraState = .limitedInitializing
      case .excessiveMotion: cameraState = .limitedExcessivemotion
      case .insufficientFeatures: cameraState = .limitedInsufficientfeatures
      case .relocalizing: cameraState = .limitedRelocalizing
      @unknown default: cameraState = .limited
      }
    }
    let fps = (Double(diagnosticFrameCount) / interval * 10).rounded() / 10
    let sessionSeconds = diagnosticSessionStart.map { CACurrentMediaTime() - $0 } ?? 0
    telemetry = ARTrackingTelemetry(
      sampleTimestamp: frame.timestamp, cameraTracking: cameraState,
      cameraFramesPerSecond: fps, objectAnchors: Double(objects.count),
      trackedObjectAnchors: Double(objects.filter(\.isTracked).count),
      allObjectAnchors: Double(allObjects.count), sessionSeconds: sessionSeconds,
      pinsEnabled: anchorEntity?.isEnabled ?? false)
    emit(currentState, currentMessage)
    #if DEBUG
    var fields: [String: Any] = [
      "cameraTracking": cameraState.stringValue,
      "cameraFramesPerSecond": fps,
      "objectAnchors": objects.count,
      "allObjectAnchors": allObjects.count,
      "objectReferenceNames": allObjects.map { $0.referenceObject.name ?? "" },
      "trackedObjectAnchors": objects.filter(\.isTracked).count,
      "rawFeaturePoints": frame.rawFeaturePoints?.points.count ?? 0,
      "pinsEnabled": anchorEntity?.isEnabled ?? false,
    ]
    if let diagnosticSessionStart {
      fields["sessionSeconds"] = CACurrentMediaTime() - diagnosticSessionStart
    }
    if let diagnosticFirstDetection { fields["firstDetectionSeconds"] = diagnosticFirstDetection }
    if let anchor = objects.first(where: { $0.identifier == anchorID }) ?? objects.first {
      let matrix = anchor.transform
      fields["anchorIsTracked"] = anchor.isTracked
      fields["worldFromObject"] = (0..<4).map { row in
        (0..<4).map { column in matrix[column][row] }
      }
    }
    trace("frame", fields)
    #endif
    diagnosticWindowStart = frame.timestamp
    diagnosticFrameCount = 0
  }
}

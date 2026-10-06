// macOS authoring helper: ray-pick physical features from a fixed diagnostic mesh view.
// Build: xcrun swiftc -O pipeline/ar/author_ar_landmarks.swift -o tools/author-ar-landmarks
// Run: tools/author-ar-landmarks <medium.usdz> <raw-landmarks.json> <preview.png>
// Output coordinates are Object Capture world coordinates; apply packFromRawReference.

import Cocoa
import SceneKit
import Metal
import CryptoKit

guard CommandLine.arguments.count == 4 else {
    fatalError("Usage: author-ar-landmarks <medium.usdz> <raw-landmarks.json> <preview.png>")
}
let modelURL = URL(fileURLWithPath: CommandLine.arguments[1])
let jsonURL = URL(fileURLWithPath: CommandLine.arguments[2])
let imageURL = URL(fileURLWithPath: CommandLine.arguments[3])
let scene = try SCNScene(url: modelURL, options: nil)
let (lo, hi) = scene.rootNode.boundingBox
let centre = SCNVector3((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2)
let span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
let camera = SCNNode()
camera.camera = SCNCamera()
camera.camera!.zNear = 0.001
camera.camera!.zFar = 100
camera.camera!.fieldOfView = 50
camera.position = SCNVector3(centre.x, centre.y + span * 0.9, centre.z + span)
camera.look(at: centre)
scene.rootNode.addChildNode(camera)
scene.background.contents = NSColor(calibratedWhite: 0.10, alpha: 1)
let renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
renderer.scene = scene
renderer.pointOfView = camera
renderer.autoenablesDefaultLighting = true
let size = CGSize(width: 1200, height: 900)
// Establish the renderer's viewport before ray-picking.
_ = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)

let features: [(String, String, Double, Double, [Double])] = [
    ("coolant-cap", "Coolant reservoir cap", 375, 438, [0.15, 0.65, 1.0]),
    ("steering-cap", "Power steering reservoir cap", 407, 460, [0.35, 0.90, 0.45]),
    ("brake-fluid-cap", "Brake fluid reservoir cap", 623, 451, [1.0, 0.72, 0.20]),
    ("air-filter-corner", "Air filter housing front right corner", 703, 463, [0.80, 0.45, 1.0]),
]
var records: [[String: Any]] = []
for (id, label, x, y, color) in features {
    // macOS SceneKit ray-picking uses a bottom-left viewport origin; PNG uses top-left.
    let hits = renderer.hitTest(CGPoint(x: x, y: size.height - y), options: [
        .searchMode: SCNHitTestSearchMode.closest.rawValue,
        .backFaceCulling: false,
    ])
    guard let hit = hits.first else { fatalError("No mesh intersection for \(id)") }
    let position = hit.worldCoordinates
    records.append([
        "id": id,
        "label": label,
        "position": [position.x, position.y, position.z],
        "color": color,
        "sourcePixel": [x, y],
        "meshPath": hit.node.name ?? "Mesh",
    ])
    let marker = SCNNode(geometry: SCNSphere(radius: CGFloat(span * 0.0025)))
    marker.geometry!.firstMaterial!.diffuse.contents = NSColor(
        calibratedRed: color[0], green: color[1], blue: color[2], alpha: 1
    )
    marker.geometry!.firstMaterial!.lightingModel = .constant
    marker.position = position
    scene.rootNode.addChildNode(marker)
    print(id, position)
}
let data = try JSONSerialization.data(withJSONObject: [
    "schemaVersion": 1,
    "coordinateSystem": "Object Capture world",
    "sourceModel": modelURL.path,
    "sourceModelSHA256": SHA256.hash(data: try Data(contentsOf: modelURL)).map { String(format: "%02x", $0) }.joined(),
    "authoringViewport": [1200, 900],
    "landmarks": records,
], options: [.prettyPrinted, .sortedKeys])
try data.write(to: jsonURL, options: .atomic)
let picture = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
guard let tiff = picture.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to render landmark preview")
}
try png.write(to: imageURL)

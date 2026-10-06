// Offline component diagnostic, NOT a replay of ARKit's private recognition/pose pipeline.
// Build: xcrun swiftc -O pipeline/ar/probe_reference.swift -o tools/probe-reference
// Run: tools/probe-reference <engine.referenceobject> [engine-photo.jpg ...]
// JSON output: model interfaces, detector heatmap peaks and timings. CPU inference on this Mac.
// Tests explicitly assumed RGB -> BT.601 YCbCr, stretch resize, and three numeric ranges.
// A heatmap peak is not a calibrated probability or ARKit's acceptance confidence.

import CoreML
import CoreGraphics
import Foundation
import ImageIO
import CryptoKit

enum ProbeError: Error { case invalidArguments, extractionFailed, invalidImage(String), invalidModel(String) }

func array(_ shape: [Int]) throws -> MLMultiArray {
  try MLMultiArray(shape: shape.map(NSNumber.init), dataType: .float16)
}

func describe(_ descriptions: [String: MLFeatureDescription]) -> [String: Any] {
  descriptions.mapValues { description -> [String: Any] in
    guard let a = description.multiArrayConstraint else { return ["type": description.type.rawValue] }
    return ["shape": a.shape.map(\.intValue), "dataType": a.dataType.rawValue]
  }
}

// Thumbnail transform applies the photo's EXIF orientation before the explicit test rotation.
func pixels(_ path: String, rotation: Int, width: Int, height: Int) throws -> [UInt8] {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
    let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 1024,
    ] as CFDictionary)
  else { throw ProbeError.invalidImage(path) }
  var data = [UInt8](repeating: 0, count: width * height * 4)
  let rendered = data.withUnsafeMutableBytes { bytes -> Bool in
    guard let context = CGContext(
      data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
      bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
    else { return false }
    context.interpolationQuality = .high
    context.translateBy(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
    context.rotate(by: CGFloat(rotation) * .pi / 2)
    let odd = rotation % 2 != 0
    let size = CGSize(width: odd ? height : width, height: odd ? width : height)
    context.draw(image, in: CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height))
    return true
  }
  guard rendered else { throw ProbeError.invalidImage(path) }
  return data
}

// Chroma is averaged over each 2x2 block. These formulas are diagnostic assumptions;
// Apple's preprocessing and pose acceptance thresholds are not part of ARKit's public API.
func detectorInputs(_ rgba: [UInt8], range: String) throws -> MLDictionaryFeatureProvider {
  let width = 432, height = 352
  let y = try array([1, 1, height, width])
  let cbcr = try array([1, 2, height / 2, width / 2])
  let yp = y.dataPointer.bindMemory(to: Float16.self, capacity: y.count)
  let cp = cbcr.dataPointer.bindMemory(to: Float16.self, capacity: cbcr.count)
  let chromaCount = width * height / 4
  for by in 0..<(height / 2) {
    for bx in 0..<(width / 2) {
      var cb: Float = 0, cr: Float = 0
      for dy in 0..<2 { for dx in 0..<2 {
        let index = (by * 2 + dy) * width + bx * 2 + dx
        let r = Float(rgba[index * 4]) / 255
        let g = Float(rgba[index * 4 + 1]) / 255
        let b = Float(rgba[index * 4 + 2]) / 255
        let luma = 0.299 * r + 0.587 * g + 0.114 * b
        yp[index] = Float16(range == "bytes" ? luma * 255 : range == "signed" ? luma * 2 - 1 : luma)
        cb += (b - luma) * 0.564 + 0.5
        cr += (r - luma) * 0.713 + 0.5
      } }
      let index = by * (width / 2) + bx
      cb /= 4; cr /= 4
      cp[index] = Float16(range == "bytes" ? cb * 255 : range == "signed" ? cb * 2 - 1 : cb)
      cp[chromaCount + index] = Float16(range == "bytes" ? cr * 255 : range == "signed" ? cr * 2 - 1 : cr)
    }
  }
  return try MLDictionaryFeatureProvider(dictionary: [
    "image_y": MLFeatureValue(multiArray: y), "image_cbcr": MLFeatureValue(multiArray: cbcr),
  ])
}

func run() throws {
  guard CommandLine.arguments.count >= 2 else { throw ProbeError.invalidArguments }
  let reference = URL(fileURLWithPath: CommandLine.arguments[1])
  let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("sfg-probe-\(UUID().uuidString)")
  try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: temporary) }
  let extract = Process()
  extract.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
  extract.arguments = ["-q", reference.path, "detector.mlmodelc/*", "tracker.mlmodelc/*", "-d", temporary.path]
  try extract.run(); extract.waitUntilExit()
  guard extract.terminationStatus == 0 else { throw ProbeError.extractionFailed }
  var interfaces: [String: Any] = [:]
  let config = MLModelConfiguration()
  config.computeUnits = .cpuOnly
  var detector: MLModel?
  for name in ["detector", "tracker"] {
    let model = try MLModel(contentsOf: temporary.appendingPathComponent("\(name).mlmodelc"), configuration: config)
    interfaces[name] = ["inputs": describe(model.modelDescription.inputDescriptionsByName),
      "outputs": describe(model.modelDescription.outputDescriptionsByName)]
    if name == "detector" { detector = model }
  }
  guard let detector,
    detector.modelDescription.inputDescriptionsByName["image_y"]?.multiArrayConstraint?.shape.map(\.intValue) == [1, 1, 352, 432],
    detector.modelDescription.inputDescriptionsByName["image_cbcr"]?.multiArrayConstraint?.shape.map(\.intValue) == [1, 2, 176, 216]
  else { throw ProbeError.invalidModel("Unexpected detector interface; preprocessing must be updated.") }
  var cases: [(String, String, Int, [UInt8])] = []
  for value: UInt8 in [0, 128, 255] {
    var rgba = [UInt8](repeating: value, count: 432 * 352 * 4)
    for i in stride(from: 3, to: rgba.count, by: 4) { rgba[i] = 255 }
    cases.append(("solid-\(value)", "synthetic-control", 0, rgba))
  }
  for (index, path) in CommandLine.arguments.dropFirst(2).enumerated() {
    for rotation in (index == 0 ? Array(0..<4) : [0]) {
      cases.append((path, "supplied-image", rotation * 90, try pixels(path, rotation: rotation, width: 432, height: 352)))
    }
  }
  var results: [[String: Any]] = []
  for (image, kind, rotation, rgba) in cases {
    for range in ["unit", "signed", "bytes"] {
      let input = try detectorInputs(rgba, range: range)
      let start = CFAbsoluteTimeGetCurrent()
      let output = try detector.prediction(from: input)
      let milliseconds = (CFAbsoluteTimeGetCurrent() - start) * 1000
      guard let hm = output.featureValue(for: "hm")?.multiArrayValue,
        hm.shape.map(\.intValue) == [1, 1, 88, 112]
      else { throw ProbeError.invalidModel("Unexpected heatmap output.") }
      let values = (0..<hm.count).map { hm[$0].doubleValue }
      guard values.allSatisfy(\.isFinite) else { throw ProbeError.invalidModel("Nonfinite heatmap values.") }
      let peak = values.indices.max(by: { values[$0] < values[$1] })!
      results.append(["image": image, "kind": kind, "rotationDegrees": rotation,
        "range": range, "heatmapPeak": values[peak], "heatmapMean": values.reduce(0, +) / Double(values.count),
        "heatmapPeakCell": [peak % 112, peak / 112], "inferenceMilliseconds": milliseconds])
    }
  }
  let report: [String: Any] = [
    "schemaVersion": 1,
    "referenceSHA256": SHA256.hash(data: try Data(contentsOf: reference)).map { String(format: "%02x", $0) }.joined(),
    "computeUnits": "cpuOnly", "host": ProcessInfo.processInfo.operatingSystemVersionString,
    "models": interfaces,
    "preprocessing": ["color": "RGB to assumed full-range BT.601 YCbCr; 2x2 averaged chroma",
      "resize": "stretch to 432x352 after EXIF orientation", "ranges": ["unit: 0..1", "signed: -1..1", "bytes: 0..255"]],
    "limitations": ["Component diagnostic; does not reproduce ARKit preprocessing, thresholds, geometric verification or pose tracking.",
      "Heatmap values are raw activations, not calibrated recognition confidence.",
      "Supplied reconstruction photos are not an independent validation dataset. Solid colors are only smoke-test negatives.",
      "Tracker interface inspected only; meaningful pose inference requires the correct crop and calibrated camera-ray inputs."],
    "results": results,
  ]
  let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

do { try run() }
catch {
  FileHandle.standardError.write(Data("probe-reference: \(error)\nUsage: probe-reference <referenceobject> [photo.jpg ...]\n".utf8))
  exit(1)
}

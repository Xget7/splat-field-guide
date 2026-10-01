// Build a textured recognition mesh from the same photos used by COLMAP.
// macOS 15+, Apple silicon. This does not train ARKit or register the mesh to the SPZ.
// Build: xcrun swiftc -parse-as-library -O pipeline/reconstruct_reference.swift -o tools/reconstruct-reference
// Check: tools/reconstruct-reference --photos data/capture/jpg --check
// Run:   tools/reconstruct-reference --photos data/capture/jpg --output data/ar-reference/gol/preview.usdz

import Foundation
import RealityKit
import simd

private enum ReferenceError: Error, LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let value): return value }
    }
}

private struct Options {
    var photos: URL?
    var output: URL?
    var detail: PhotogrammetrySession.Request.Detail = .preview
    var detailName = "preview"
    var checkOnly = false

    static let usage = """
    reconstruct-reference --photos <directory> [--output <model.usdz>]
                          [--detail preview|reduced|medium|full] [--check]

    --check validates inputs and reports device support without starting reconstruction.
    Reconstruction also writes <model>.poses.json and <model>.capture.json.
    Existing outputs are never overwritten. Preview is for inspection, not final training.
    """

    static func parse(_ args: [String]) throws -> Options {
        var result = Options()
        var index = 0
        while index < args.count {
            let option = args[index]
            if option == "--check" {
                result.checkOnly = true
                index += 1
                continue
            }
            guard ["--photos", "--output", "--detail"].contains(option), index + 1 < args.count else {
                throw ReferenceError.message("Invalid argument: \(option)\n\(usage)")
            }
            let value = args[index + 1]
            switch option {
            case "--photos": result.photos = URL(fileURLWithPath: value).standardizedFileURL
            case "--output": result.output = URL(fileURLWithPath: value).standardizedFileURL
            case "--detail":
                switch value {
                case "preview": result.detail = .preview
                case "reduced": result.detail = .reduced
                case "medium": result.detail = .medium
                case "full": result.detail = .full
                default: throw ReferenceError.message("Unknown detail: \(value)")
                }
                result.detailName = value
            default: break
            }
            index += 2
        }
        guard result.photos != nil else { throw ReferenceError.message(usage) }
        if !result.checkOnly && result.output == nil { throw ReferenceError.message(usage) }
        if let output = result.output, output.pathExtension.lowercased() != "usdz" {
            throw ReferenceError.message("The output must have the .usdz extension.")
        }
        return result
    }
}

private func writeJSON(_ value: Any, to url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url, options: .atomic)
}

private func matrixRows(_ matrix: simd_float4x4) -> [[Float]] {
    (0..<4).map { row in (0..<4).map { column in matrix[column][row] } }
}

@main
private struct ReconstructReference {
    static func main() async {
        if CommandLine.arguments.dropFirst().contains("--help") {
            print(Options.usage)
            return
        }
        do {
            try await run(Options.parse(Array(CommandLine.arguments.dropFirst())))
        } catch {
            FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    static func run(_ options: Options) async throws {
        guard let photos = options.photos else { throw ReferenceError.message("Missing photos.") }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: photos.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw ReferenceError.message("Photo directory does not exist: \(photos.path)")
        }
        let extensions: Set<String> = ["jpg", "jpeg", "heic", "png", "tif", "tiff"]
        let files = try FileManager.default.contentsOfDirectory(at: photos, includingPropertiesForKeys: [.isRegularFileKey])
            .filter { url in
                extensions.contains(url.pathExtension.lowercased()) &&
                (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
            }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        guard !files.isEmpty else { throw ReferenceError.message("No supported photos in \(photos.path)") }
        guard files.count <= PhotogrammetrySession.limits.maximumNumberOfInputImages else {
            throw ReferenceError.message("Too many photos for this device: \(files.count)")
        }
        let report: [String: Any] = [
            "schemaVersion": 1,
            "sourceDirectory": photos.path,
            "files": files.map(\.lastPathComponent),
            "photoCount": files.count,
            "detail": options.detailName,
            "photogrammetrySupported": PhotogrammetrySession.isSupported,
            "objectMaskingEnabled": false,
            "note": "Raw reconstruction. Validate geometry, physical scale and registration before training.",
        ]
        print("photos=\(files.count) supported=\(PhotogrammetrySession.isSupported) detail=\(options.detailName)")
        if options.checkOnly { return }
        guard PhotogrammetrySession.isSupported else {
            throw ReferenceError.message("Object Capture is not supported on this Mac.")
        }
        guard let output = options.output else { throw ReferenceError.message("Missing output.") }
        let posesURL = output.deletingPathExtension().appendingPathExtension("poses.json")
        let reportURL = output.deletingPathExtension().appendingPathExtension("capture.json")
        for url in [output, posesURL, reportURL] where FileManager.default.fileExists(atPath: url.path) {
            throw ReferenceError.message("Refusing to overwrite \(url.path)")
        }
        try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

        var config = PhotogrammetrySession.Configuration()
        config.sampleOrdering = .unordered
        // This is an assembled engine bay, rather than a freestanding object on a turntable.
        // Keep all photographed structure; inspect/crop the resulting mesh before training.
        config.isObjectMaskingEnabled = false
        let session = try PhotogrammetrySession(input: photos, configuration: config)
        try session.process(requests: [.modelFile(url: output, detail: options.detail), .poses])
        var modelComplete = false
        var posesComplete = false
        var lastPercent = -1
        for try await event in session.outputs {
            switch event {
            case .requestProgress(let request, let fraction):
                if case .modelFile = request {
                    let percent = Int(fraction * 100)
                    if percent != lastPercent {
                        print("reconstruction \(percent)%")
                        lastPercent = percent
                    }
                }
            case .requestComplete(_, let result):
                switch result {
                case .modelFile(let url):
                    modelComplete = true
                    print("model: \(url.path)")
                case .poses(let poses):
                    let entries: [[String: Any]] = poses.posesBySample.keys.sorted().map { id in
                        let pose = poses.posesBySample[id]!
                        var entry: [String: Any] = ["sampleID": id, "transform": matrixRows(pose.transform.matrix)]
                        if let url = poses.urlsBySample[id] { entry["image"] = url.lastPathComponent }
                        return entry
                    }
                    try writeJSON([
                        "schemaVersion": 1,
                        "matrixOrder": "rows",
                        "coordinateSystem": "PhotogrammetrySession.Pose.transform (not COLMAP or pack)",
                        "poses": entries,
                    ], to: posesURL)
                    posesComplete = true
                    print("poses: \(entries.count) -> \(posesURL.path)")
                default: break
                }
            case .requestError(_, let error): session.cancel(); throw error
            case .invalidSample(let id, let reason): print("invalid sample \(id): \(reason)")
            case .skippedSample(let id): print("skipped sample \(id)")
            case .automaticDownsampling: print("Object Capture downsampled the input images.")
            case .processingCancelled: throw ReferenceError.message("Reconstruction cancelled.")
            case .processingComplete:
                guard modelComplete, posesComplete, FileManager.default.fileExists(atPath: output.path) else {
                    throw ReferenceError.message("Reconstruction ended without the model and camera poses.")
                }
                try writeJSON(report, to: reportURL)
                print("Complete. Inspect the USDZ and register it to the pack before Create ML training.")
                return
            default: break
            }
        }
        throw ReferenceError.message("Object Capture ended before processingComplete.")
    }
}

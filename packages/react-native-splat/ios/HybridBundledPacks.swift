import Foundation
import NitroModules

/// Reads the manifests the build copied under the bundle's `packs` resources, the same root that
/// `HybridSplatView` resolves relative pack paths against.
class HybridBundledPacks: HybridBundledPacksSpec {
  private static let packsDirectory = "packs"
  private static let manifestName = "manifest.json"

  func manifests() throws -> [BundledPackManifest] {
    guard let resources = Bundle.main.resourceURL else { return [] }
    let root = resources.appendingPathComponent(Self.packsDirectory, isDirectory: true)
    var found: [BundledPackManifest] = []
    for packId in try Self.directories(in: root) {
      for version in try Self.directories(in: root.appendingPathComponent(packId)) {
        let directory = "\(packId)/\(version)"
        let file = root.appendingPathComponent(directory).appendingPathComponent(Self.manifestName)
        guard FileManager.default.fileExists(atPath: file.path) else { continue }
        // An unreadable manifest is a broken bundle, so it fails discovery instead of hiding the pack.
        let manifest = try String(contentsOf: file, encoding: .utf8)
        found.append(BundledPackManifest(directory: directory, manifest: manifest))
      }
    }
    return found.sorted { $0.directory < $1.directory }
  }

  private static func directories(in url: URL) throws -> [String] {
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    return try FileManager.default
      .contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey])
      .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
      .map(\.lastPathComponent)
  }
}

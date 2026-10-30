import CoreML
import CryptoKit
import Foundation

/// The caller serializes access and owns the immutable resource directory for this engine's lifetime.
final class PartRetrievalEngine {
  private struct FileReceipt: Decodable {
    let path: String
    let sha256: String
  }
  private struct ModelReceipt: Decodable {
    let path: String
    let files: [FileReceipt]
  }
  private struct Receipt: Decodable {
    let schemaVersion: Int
    let purpose: String
    let computeUnits: String
    let spaceId: String
    let dimensions: Int
    let contextLength: Int
    let model: ModelReceipt
    let vocabulary: FileReceipt
    let merges: FileReceipt
    let prototypes: FileReceipt
    let partIds: [String]
  }

  let spaceId: String
  let partIds: [String]
  private let model: MLModel
  private let tokenizer: PartRetrievalTokenizer
  private let index: PartRetrievalIndex
  private static let maximumModelBytes: UInt64 = 512 * 1024 * 1024
  private static let inputName = "text"
  private static let outputName = "final_emb_1"

  init(directory: URL, expectedReceiptSha256: String) throws {
    let root = directory.standardizedFileURL.resolvingSymlinksInPath()
    let receiptURL = try Self.child("receipt.json", of: root)
    let receiptData = try Self.read(receiptURL, maximumBytes: 1024 * 1024)
    try Self.verifyDigest(receiptData, expected: expectedReceiptSha256)
    let receipt = try JSONDecoder().decode(Receipt.self, from: receiptData)
    guard receipt.schemaVersion == 1, receipt.purpose == "local-evaluation",
      receipt.computeUnits == "cpuOnly", receipt.dimensions == 512,
      receipt.contextLength == PartRetrievalTokenizer.contextLength,
      !receipt.spaceId.isEmpty, receipt.spaceId.utf8.count <= 256
    else { throw PartRetrievalFailure.invalid("Unsupported resource configuration") }

    let vocabularyData = try Self.readVerified(receipt.vocabulary, root: root, maximumBytes: 8 * 1024 * 1024)
    let mergesData = try Self.readVerified(receipt.merges, root: root, maximumBytes: 4 * 1024 * 1024)
    tokenizer = try PartRetrievalTokenizer(vocabulary: vocabularyData, merges: mergesData)
    let prototypeData = try Self.readVerified(receipt.prototypes, root: root,
      maximumBytes: PartRetrievalIndex.maximumParts * receipt.dimensions * 4)
    index = try PartRetrievalIndex(bytes: prototypeData, partIds: receipt.partIds,
      dimensions: receipt.dimensions)

    let modelURL = try Self.child(receipt.model.path, of: root)
    guard modelURL.pathExtension == "mlmodelc", !receipt.model.files.isEmpty,
      receipt.model.files.count <= 1000,
      Set(receipt.model.files.map(\.path)).count == receipt.model.files.count
    else { throw PartRetrievalFailure.invalid("Invalid compiled model inventory") }
    let enumerator = FileManager.default.enumerator(at: modelURL,
      includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard let enumerator else { throw PartRetrievalFailure.invalid("Missing compiled model") }
    var inventory = Set<String>()
    var totalBytes: UInt64 = 0
    for case let url as URL in enumerator {
      let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
      guard attributes.isSymbolicLink != true else {
        throw PartRetrievalFailure.invalid("Model inventory contains a symbolic link")
      }
      if attributes.isRegularFile == true {
        inventory.insert(String(url.path.dropFirst(modelURL.path.count + 1)))
        totalBytes += UInt64(attributes.fileSize ?? 0)
        guard totalBytes <= Self.maximumModelBytes else {
          throw PartRetrievalFailure.invalid("Compiled model exceeds resource limit")
        }
      }
    }
    guard inventory == Set(receipt.model.files.map(\.path)) else {
      throw PartRetrievalFailure.invalid("Compiled model inventory mismatch")
    }
    for file in receipt.model.files {
      let url = try Self.child(file.path, of: modelURL)
      try Self.verifyFile(url, expected: file.sha256)
    }

    let configuration = MLModelConfiguration()
    // CPU parity is the first measured space; another backend needs separate validation.
    configuration.computeUnits = .cpuOnly
    model = try MLModel(contentsOf: modelURL, configuration: configuration)
    let inputs = model.modelDescription.inputDescriptionsByName
    let outputs = model.modelDescription.outputDescriptionsByName
    guard Set(inputs.keys) == [Self.inputName], Set(outputs.keys) == [Self.outputName],
      let input = inputs[Self.inputName]?.multiArrayConstraint,
      input.dataType == .int32, input.shape.map(\.intValue) == [1, 77],
      let output = outputs[Self.outputName]?.multiArrayConstraint,
      output.dataType == .float32, output.shape.map(\.intValue) == [1, 512]
    else { throw PartRetrievalFailure.invalid("Text model feature contract mismatch") }
    spaceId = receipt.spaceId
    partIds = receipt.partIds
  }

  func search(text: String, limit: Int) throws -> [(partId: String, score: Double)] {
    guard (1...100).contains(limit) else { throw PartRetrievalFailure.invalid("Invalid result limit") }
    let ids = try tokenizer.encode(text)
    let input = try MLMultiArray(shape: [1, 77], dataType: .int32)
    for (index, id) in ids.enumerated() { input[index] = NSNumber(value: id) }
    let features = try MLDictionaryFeatureProvider(dictionary: [Self.inputName: input])
    let output = try model.prediction(from: features)
    guard let vector = output.featureValue(for: Self.outputName)?.multiArrayValue,
      vector.count == 512 else { throw PartRetrievalFailure.invalid("Missing text embedding") }
    return try index.search(embedding: (0..<vector.count).map { vector[$0].doubleValue }, limit: limit)
  }

  private static func child(_ path: String, of root: URL) throws -> URL {
    let components = path.split(separator: "/", omittingEmptySubsequences: false)
    guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"),
      components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
      throw PartRetrievalFailure.invalid("Invalid resource path")
    }
    let url = root.appendingPathComponent(path).standardizedFileURL
    guard url.resolvingSymlinksInPath().path == url.path,
      url.path.hasPrefix(root.path + "/") else {
      throw PartRetrievalFailure.invalid("Resource path escapes its directory")
    }
    return url
  }

  private static func read(_ url: URL, maximumBytes: Int) throws -> Data {
    let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard attributes.isRegularFile == true, let size = attributes.fileSize,
      size >= 0, size <= maximumBytes else { throw PartRetrievalFailure.invalid("Invalid resource size") }
    let data = try Data(contentsOf: url)
    guard data.count <= maximumBytes else { throw PartRetrievalFailure.invalid("Resource changed while reading") }
    return data
  }

  private static func readVerified(_ file: FileReceipt, root: URL, maximumBytes: Int) throws -> Data {
    let data = try read(child(file.path, of: root), maximumBytes: maximumBytes)
    try verifyDigest(data, expected: file.sha256)
    return data
  }

  private static func validDigest(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }

  private static func verifyDigest(_ data: Data, expected: String) throws {
    guard validDigest(expected), SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == expected
    else { throw PartRetrievalFailure.invalid("Resource digest mismatch") }
  }

  private static func verifyFile(_ url: URL, expected: String) throws {
    guard validDigest(expected) else { throw PartRetrievalFailure.invalid("Invalid resource digest") }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var hasher = SHA256()
    var count: UInt64 = 0
    while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
      count += UInt64(chunk.count)
      guard count <= maximumModelBytes else { throw PartRetrievalFailure.invalid("Model file exceeds resource limit") }
      hasher.update(data: chunk)
    }
    guard hasher.finalize().map({ String(format: "%02x", $0) }).joined() == expected else {
      throw PartRetrievalFailure.invalid("Model digest mismatch")
    }
  }
}

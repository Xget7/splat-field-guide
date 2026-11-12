import CryptoKit
import Foundation
import QuickLook
import React
import UIKit

@objc(CourseDocuments)
final class CourseDocuments: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func catalog() throws -> [[String: Any]] {
    guard let url = Bundle.main.url(forResource: "index", withExtension: "json", subdirectory: "documents") else {
      return []
    }
    guard let entries = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]] else {
      throw NSError(domain: "CourseDocuments", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid document catalog"])
    }
    return entries
  }

  private func verifiedURL(_ document: [String: Any]) -> URL? {
    guard let file = document["file"] as? String,
          file == (file as NSString).lastPathComponent,
          file.hasSuffix(".pdf"),
          let expected = document["sha256"] as? String,
          let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "documents"),
          let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
    let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return actual == expected ? url : nil
  }

  @objc(list:rejecter:)
  func list(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      let entries = try catalog().map { entry -> [String: Any] in
        var result = entry
        result["available"] = verifiedURL(entry) != nil
        return result
      }
      resolve(entries)
    } catch {
      reject("documents-unreadable", "Could not read the bundled document catalog", error)
    }
  }

  @objc(open:resolver:rejecter:)
  func open(_ identifier: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      guard let entry = try catalog().first(where: { $0["id"] as? String == identifier }),
            let url = verifiedURL(entry) else {
        reject("document-unavailable", "This document is not available on this device", nil)
        return
      }
      DispatchQueue.main.async {
        let root = UIApplication.shared.connectedScenes
          .compactMap { $0 as? UIWindowScene }
          .filter { $0.activationState == .foregroundActive }
          .flatMap { $0.windows }
          .first { $0.isKeyWindow }?.rootViewController
        guard var presenter = root else {
          reject("document-presenter-unavailable", "The document viewer is not available", nil)
          return
        }
        while let presented = presenter.presentedViewController {
          presenter = presented
        }
        guard !(presenter is LocalPDFPreviewController) else {
          reject("document-already-open", "Close the current document before opening another", nil)
          return
        }
        let preview = LocalPDFPreviewController(url: url, title: entry["edition"] as? String)
        presenter.present(preview, animated: true) { resolve(nil) }
      }
    } catch {
      reject("document-unreadable", "Could not open the bundled document", error)
    }
  }
}

private final class LocalPDFPreviewController: QLPreviewController, QLPreviewControllerDataSource {
  private let documentURL: URL

  init(url: URL, title: String?) {
    documentURL = url
    super.init(nibName: nil, bundle: nil)
    self.title = title
    dataSource = self
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    documentURL as NSURL
  }
}

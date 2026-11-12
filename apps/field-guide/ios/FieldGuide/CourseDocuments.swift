import CryptoKit
import Foundation
import PDFKit
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

  /// `page` counts PDF pages from one; JavaScript has already mapped the printed page through the catalog offset.
  @objc(open:page:resolver:rejecter:)
  func open(_ identifier: String, page: NSNumber?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
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
        guard !(presenter is LocalPDFNavigationController) else {
          reject("document-already-open", "Close the current document before opening another", nil)
          return
        }
        guard let document = PDFDocument(url: url) else {
          reject("document-unreadable", "Could not open the bundled document", nil)
          return
        }
        var target: PDFPage?
        if let page {
          target = document.page(at: page.intValue - 1)
          guard target != nil else {
            reject("document-page-missing", "This page is not in the document", nil)
            return
          }
        }
        let reader = LocalPDFViewController(document: document, page: target, title: entry["edition"] as? String)
        presenter.present(LocalPDFNavigationController(rootViewController: reader), animated: true) { resolve(nil) }
      }
    } catch {
      reject("document-unreadable", "Could not open the bundled document", error)
    }
  }
}

/// Marks a presented local document so a second open is refused instead of stacking viewers.
private final class LocalPDFNavigationController: UINavigationController {
  override init(rootViewController: UIViewController) {
    super.init(rootViewController: rootViewController)
    // Manual drawings need the whole screen to stay legible.
    modalPresentationStyle = .fullScreen
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
}

/// PDFKit rather than QuickLook, because QuickLook cannot open a document at a cited page.
private final class LocalPDFViewController: UIViewController {
  private let pdfView = PDFView()
  private let document: PDFDocument
  private var target: PDFPage?

  init(document: PDFDocument, page: PDFPage?, title: String?) {
    self.document = document
    target = page
    super.init(nibName: nil, bundle: nil)
    self.title = title
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    pdfView.autoScales = true
    pdfView.displayMode = .singlePageContinuous
    pdfView.displayDirection = .vertical
    pdfView.document = document
    pdfView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(pdfView)
    // Going to a page puts its top at the view's top, so start below the bar or the page heading hides under it.
    NSLayoutConstraint.activate([
      pdfView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      pdfView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      pdfView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      pdfView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .done,
      primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) }
    )
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // PDFView ignores navigation before it has a size, so go to the page on the first real layout.
    guard let page = target, pdfView.bounds.width > 0 else { return }
    target = nil
    // Auto scaling settles during this layout pass; going earlier offsets the page and hides its running header.
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      let bounds = page.bounds(for: self.pdfView.displayBox)
      self.pdfView.go(to: PDFDestination(page: page, at: CGPoint(x: bounds.minX, y: bounds.maxY)))
    }
  }
}

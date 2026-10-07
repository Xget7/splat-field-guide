import Foundation
import AppKit
import RealityKit
import simd

@main
struct ARPlacementAssemblyHarness {
  private struct Preparation: Decodable {
    let assemblyOrder: [String]
  }

  private struct BatchPlan: Decodable {
    struct Batch: Decodable { let endPartCount: Int }
    let assemblyBatches: [Batch]
    let assemblyOrder: [String]
  }

  private struct Renderer {
    let entity: Entity
    let opacity: OpacityComponent?
    let model: ModelComponent
  }

  private struct AuthoredPart {
    let entity: Entity
    let parent: Entity?
    let transform: Transform
    let opacity: OpacityComponent?
    let renderers: [Renderer]
  }

  @MainActor
  static func main() {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    Task { @MainActor in
      do { try await run() }
      catch { fatalError(error.localizedDescription) }
      exit(0)
    }
    application.run()
  }

  @MainActor
  private static func run() async throws {
    precondition(CommandLine.arguments.count == 4, "Pass the prepared V8 USDZ, receipt and batch metadata.")
    let preparation = try JSONDecoder().decode(Preparation.self,
      from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
    let plan = try JSONDecoder().decode(BatchPlan.self,
      from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3])))
    let order = plan.assemblyOrder
    precondition(Set(order) == Set(preparation.assemblyOrder))
    let ends = plan.assemblyBatches.map(\.endPartCount)
    precondition(ends.count == 12 && ends.last == 128 && ends == ends.sorted())
    precondition(order.count == 128 && Set(order).count == 128)
    let capture = try await Entity(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let equipment = Entity()
    let content = Entity()
    equipment.addChild(content)
    content.addChild(capture)
    let authored = authoredParts(in: content, names: Set(order))
    precondition(authored.count == 128, "RealityKit must preserve every independently movable authored part.")
    let assembly = ARPlacementAssembly(content: content, order: order)
    precondition(assembly.parts.count == 128)
    precondition(Set(assembly.parts.map(\.id)).count == 128)
    for (index, name) in order.enumerated() {
      precondition(assembly.parts[index].id.contains("/\(name)["), "Native order must match the preparation receipt.")
    }
    var bootstrapSnapshots: [ARPlacementAssembly.Snapshot] = []
    assembly.onChange = { bootstrapSnapshots.append($0) }
    assembly.apply(assembledCount: 1, exploded: true, animated: false)
    precondition(bootstrapSnapshots.count == 1 && bootstrapSnapshots[0].phase == "idle"
      && bootstrapSnapshots[0].assembledCount == 1, "Bootstrap must acknowledge the installed first part exactly once.")
    precondition(order[0] == "crankshaft")
    assertTransform(authored[order[0]]!.entity.transform, authored[order[0]]!.transform)
    assembly.onChange = nil
    assembly.apply(assembledCount: 128, exploded: true, animated: false)
    let originalEquipment = equipment.transform
    let originalContent = content.transform
    let originalBounds = content.visualBounds(relativeTo: content)
    for count in 0...128 {
      precondition(assembly.apply(assembledCount: count, exploded: true, animated: false) == count)
      verify(authored: authored, order: order, assembledCount: count, upcomingEnd: visibleEnd(count, order: order), content: content)
      assertTransform(equipment.transform, originalEquipment)
      assertTransform(content.transform, originalContent)
    }
    equipment.scale = SIMD3(repeating: 1.3)
    equipment.orientation = simd_quatf(angle: .pi / 2, axis: SIMD3(0, 1, 0))
    let resizedEquipment = equipment.transform
    for count in stride(from: 128, through: 0, by: -1) {
      precondition(assembly.apply(assembledCount: count, exploded: true, animated: false) == count)
      verify(authored: authored, order: order, assembledCount: count, upcomingEnd: visibleEnd(count, order: order), content: content)
      assertTransform(equipment.transform, resizedEquipment)
      assertTransform(content.transform, originalContent)
    }
    assembly.apply(assembledCount: 64, exploded: false, animated: false)
    verify(authored: authored, order: order, assembledCount: 128, upcomingEnd: 128, content: content)
    assembly.apply(assembledCount: 64, exploded: true, animated: false)
    verify(authored: authored, order: order, assembledCount: 64, upcomingEnd: visibleEnd(64, order: order), content: content)
    assembly.apply(assembledCount: 128, exploded: true, animated: false)
    let restored = content.visualBounds(relativeTo: content)
    precondition(simd_length(originalBounds.min - restored.min) < 0.00001)
    precondition(simd_length(originalBounds.max - restored.max) < 0.00001)
    let existingOpacityPart = authored[order.last!]!.entity
    existingOpacityPart.components.set(OpacityComponent(opacity: 0.7))
    let preservingOpacity = ARPlacementAssembly(content: content, order: order)
    preservingOpacity.apply(assembledCount: 0, exploded: true, animated: false)
    precondition(abs(existingOpacityPart.components[OpacityComponent.self]!.opacity - 0.7) < 0.00001)
    preservingOpacity.apply(assembledCount: 0, exploded: false, animated: false)
    precondition(existingOpacityPart.components[OpacityComponent.self] == OpacityComponent(opacity: 0.7))
    existingOpacityPart.components.remove(OpacityComponent.self)
    let view = ARView(frame: NSRect(x: 0, y: 0, width: 320, height: 240))
    let window = NSWindow(contentRect: view.frame, styleMask: [.titled], backing: .buffered, defer: false)
    window.contentView = view
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    let anchor = AnchorEntity(world: .zero)
    anchor.addChild(equipment)
    view.scene.addAnchor(anchor)
    assembly.apply(assembledCount: 0, exploded: true, animated: false, requestId: 1)
    var snapshots: [ARPlacementAssembly.Snapshot] = []
    assembly.onChange = { snapshot in
      snapshots.append(snapshot)
      if snapshot.phase == "assembling" {
        verify(authored: authored, order: order, assembledCount: snapshot.assembledCount,
          upcomingEnd: visibleEnd(snapshot.assembledCount, order: order), content: content)
      }
    }
    assembly.apply(assembledCount: 3, exploded: true, animated: true, requestId: 2, scene: view.scene)
    precondition(assembly.settledCount == 0 && authored[order[1]]!.entity.isEnabled == false)
    let deadline = Date().addingTimeInterval(20)
    while snapshots.last?.phase != "idle" && Date() < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    precondition(assembly.settledCount == 3, "Actual playback completion must settle all requested parts.")
    precondition(snapshots.filter { $0.phase == "assembling" }.map(\.assembledCount) == [0, 1, 2])
    assembly.apply(assembledCount: 6, exploded: true, animated: true, requestId: 3, scene: view.scene)
    assembly.cancel()
    precondition(assembly.settledCount == 3 && snapshots.last?.phase == "idle")
    verify(authored: authored, order: order, assembledCount: 3, upcomingEnd: 4, content: content)
    assembly.apply(assembledCount: 2, exploded: true, animated: true, requestId: 4, scene: view.scene)
    while snapshots.last?.phase != "idle" && Date() < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    precondition(assembly.settledCount == 2 && snapshots.contains { $0.phase == "separating" })
    assembly.apply(assembledCount: 2, exploded: false, animated: true, requestId: 5, scene: view.scene)
    precondition(snapshots.last?.phase == "previewing" && assembly.settledCount == 2)
    while snapshots.last?.phase != "idle" && Date() < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    precondition(assembly.settledCount == 2)
    verify(authored: authored, order: order, assembledCount: 128, upcomingEnd: 128, content: content)
    assembly.cancel()
    precondition(assembly.settledCount == 2 && snapshots.last?.phase == "idle")
    verify(authored: authored, order: order, assembledCount: 128, upcomingEnd: 128, content: content)
    assembly.apply(assembledCount: 2, exploded: true, animated: true, requestId: 6, scene: view.scene)
    while snapshots.last?.phase != "idle" && Date() < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    verify(authored: authored, order: order, assembledCount: 2, upcomingEnd: 3, content: content)
    assembly.apply(assembledCount: 2, exploded: false, animated: true, requestId: 7, scene: view.scene)
    precondition(snapshots.last?.phase == "previewing")
    assembly.cancel()
    precondition(assembly.settledCount == 2 && snapshots.last?.phase == "idle")
    verify(authored: authored, order: order, assembledCount: 128, upcomingEnd: 128, content: content)
    assembly.apply(assembledCount: 17, exploded: true, animated: false, requestId: 8)
    let groupSnapshotsStart = snapshots.count
    assembly.apply(assembledCount: 49, exploded: true, animated: true, requestId: 9, scene: view.scene)
    precondition(assembly.settledCount == 17 && authored[order[48]]!.entity.isEnabled
      && !authored[order[49]]!.entity.isEnabled)
    let groupDeadline = Date().addingTimeInterval(10)
    while snapshots.last?.phase != "idle" && Date() < groupDeadline {
      precondition(assembly.settledCount == 17 || assembly.settledCount == 49,
        "A fastener group must settle only after every playback completes.")
      try await Task.sleep(for: .milliseconds(20))
    }
    precondition(assembly.settledCount == 49)
    precondition(snapshots.dropFirst(groupSnapshotsStart).filter { $0.phase == "assembling" }
      .map(\.assembledCount) == [17])
    assembly.apply(assembledCount: 33, exploded: true, animated: true, requestId: 10, scene: view.scene)
    while snapshots.last?.phase != "idle" && Date() < groupDeadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    precondition(assembly.settledCount == 33, "Reverse groups must stop at a partial target.")
    verify(authored: authored, order: order, assembledCount: 33, upcomingEnd: 49, content: content)
    assembly.apply(assembledCount: 49, exploded: true, animated: true, requestId: 11, scene: view.scene)
    assembly.cancel()
    precondition(assembly.settledCount == 33 && snapshots.last?.phase == "idle")
    verify(authored: authored, order: order, assembledCount: 33, upcomingEnd: 49, content: content)
    assembly.apply(assembledCount: 49, exploded: true, animated: true, requestId: 12, scene: view.scene)
    assembly.apply(assembledCount: 53, exploded: true, animated: true, requestId: 13, scene: view.scene)
    precondition(assembly.settledCount == 49 && snapshots.last?.phase == "assembling",
      "Next during assembly must finish the current step and start the following step.")
    precondition(authored[order[49]]!.entity.isEnabled && !authored[order[50]]!.entity.isEnabled)
    for index in 0..<49 { assertTransform(authored[order[index]]!.entity.transform, authored[order[index]]!.transform) }
    assembly.cancel()
    precondition(assembly.settledCount == 49, "Cancelling the following step must retain the completed prior step.")
    assembly.apply(assembledCount: 53, exploded: true, animated: true, requestId: 14, scene: view.scene)
    assembly.apply(assembledCount: 53, exploded: true, animated: true, requestId: 15, scene: view.scene)
    precondition(assembly.settledCount == 53 && snapshots.last?.phase == "idle",
      "A new command at the current target must finish its active step immediately.")
    assembly.onChange = nil
    view.scene.removeAnchor(anchor)
    window.close()
    print("V8 128 authored parts, forward/reverse visibility and real sequential playback verified")
    print("V8 128 parts, 129 forward states and 129 reverse states verified against authored transforms")
    print("V8 original opacity, material textures and complete-preview restoration verified")
    print("V8 assembled bounds \(originalBounds.extents) metres")
    print("AR placement assembly passed")
  }

  private static func visibleEnd(_ count: Int, order: [String]) -> Int {
    let groups = [17..<49, 57..<73, 78..<86, 91..<107, 111..<119]
    return groups.first { $0.contains(count) }?.upperBound ?? min(order.count, count + 1)
  }

  @MainActor
  private static func authoredParts(in entity: Entity, names: Set<String>) -> [String: AuthoredPart] {
    var parts: [String: AuthoredPart] = [:]
    if names.contains(entity.name) {
      parts[entity.name] = AuthoredPart(entity: entity, parent: entity.parent, transform: entity.transform,
        opacity: entity.components[OpacityComponent.self], renderers: renderers(in: entity))
    }
    for child in entity.children {
      for (name, part) in authoredParts(in: child, names: names) {
        precondition(parts[name] == nil, "Authored part names must be unambiguous after import.")
        parts[name] = part
      }
    }
    return parts
  }

  @MainActor
  private static func verify(authored: [String: AuthoredPart], order: [String], assembledCount: Int,
    upcomingEnd: Int, content: Entity) {
    for (index, name) in order.enumerated() {
      let part = authored[name]!
      precondition(part.entity.parent === part.parent, "An assembly step must preserve the authored hierarchy.")
      let transform = part.entity.transform
      let opacity = part.entity.components[OpacityComponent.self]
      precondition(opacity == part.opacity, "Parts must retain their original opacity component.")
      for renderer in part.renderers {
        precondition(renderer.entity.components[OpacityComponent.self] == renderer.opacity,
          "The part opacity must propagate to renderers without overwriting their own opacity.")
        let model = renderer.entity.components[ModelComponent.self]!
        precondition(model.mesh === renderer.model.mesh && model.materials.count == renderer.model.materials.count)
        for (current, original) in zip(model.materials, renderer.model.materials) {
          if let current = current as? PhysicallyBasedMaterial, let original = original as? PhysicallyBasedMaterial {
            precondition(current.baseColor.texture?.resource === original.baseColor.texture?.resource)
            precondition(current.normal.texture?.resource === original.normal.texture?.resource)
            precondition(current.roughness.texture?.resource === original.roughness.texture?.resource)
            precondition(current.metallic.texture?.resource === original.metallic.texture?.resource)
          }
        }
      }
      precondition(simd_length(transform.scale - part.transform.scale) < 0.00001)
      precondition(simd_length(transform.rotation.vector - part.transform.rotation.vector) < 0.00001)
      if index < assembledCount {
        precondition(simd_length(transform.translation - part.transform.translation) < 0.00001,
          "Assembled pose mismatch for \(name), settled \(assembledCount), actual \(transform.translation), expected \(part.transform.translation)")
        assertTransform(transform, part.transform)
      } else {
        precondition(simd_length(transform.translation - part.transform.translation) > 0.00001,
          "Every remaining part must be separated in the exploded view.")
      }
      let bounds = part.entity.visualBounds(relativeTo: content)
      precondition((0..<3).allSatisfy { bounds.extents[$0].isFinite && bounds.extents[$0] > 0.000001 },
        "Every part must retain finite nondegenerate geometry at every step.")
      precondition(part.entity.isEnabled == (index < upcomingEnd), "Only the settled prefix and next part are visible.")

    }
  }

  @MainActor
  private static func renderers(in entity: Entity) -> [Renderer] {
    var renderers: [Renderer] = []
    if let model = entity.components[ModelComponent.self] {
      renderers.append(Renderer(entity: entity, opacity: entity.components[OpacityComponent.self], model: model))
    }
    for child in entity.children { renderers.append(contentsOf: self.renderers(in: child)) }
    return renderers
  }

  private static func assertTransform(_ actual: Transform, _ expected: Transform) {
    precondition(simd_length(actual.scale - expected.scale) < 0.00001)
    precondition(simd_length(actual.rotation.vector - expected.rotation.vector) < 0.00001)
    precondition(simd_length(actual.translation - expected.translation) < 0.00001)
  }
}

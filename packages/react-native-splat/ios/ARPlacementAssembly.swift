import Foundation
import Combine
import RealityKit
import simd

/// Keeps the authored assembly intact while moving independent parts within it.
@MainActor
final class ARPlacementAssembly {
  struct Part {
    let id: String
    let label: String
  }

  private struct Placement {
    let entity: Entity
    let assembled: Transform
    let separated: Transform
    let opacity: OpacityComponent?
  }

  let parts: [Part]
  private let placements: [Placement]
  struct Snapshot {
    let assembledCount: Int
    let requestId: Double
    let phase: String
  }

  private var active: [Int: AnimationPlaybackController] = [:]
  private var activeEnd = 0
  private var subscription: (any Cancellable)?
  private var generation = 0
  private(set) var settledCount = 0
  private var showingComplete = false
  private var requestId: Double = 0
  private var previousTarget: Int?
  private var previousExploded: Bool?
  var onChange: ((Snapshot) -> Void)?
  private static let animationDuration: TimeInterval = 1.35
  private static let goldenAngle: Float = 2.3999632

  init(content: Entity, order: [String] = []) {
    let bounds = content.visualBounds(relativeTo: content)
    let centre = bounds.center
    let extent = bounds.extents
    let distance = max(0.001, max(extent.x, max(extent.y, extent.z)))
    var priority: [String: Int] = [:]
    for (index, name) in order.enumerated() where priority[name] == nil { priority[name] = index }
    let candidates = Self.independentParts(in: content).enumerated().sorted {
      let left = priority[$0.element.name] ?? order.count
      let right = priority[$1.element.name] ?? order.count
      return left == right ? $0.offset < $1.offset : left < right
    }.map(\.element)
    var parts: [Part] = []
    var placements: [Placement] = []
    for (index, entity) in candidates.enumerated() {
      let partBounds = entity.visualBounds(relativeTo: content)
      guard (0..<3).allSatisfy({ partBounds.center[$0].isFinite && partBounds.extents[$0].isFinite })
      else { continue }
      let relativeCentre = partBounds.center - centre
      var outward = SIMD3(relativeCentre.x, 0, relativeCentre.z)
      let angle = Float(index) * Self.goldenAngle
      if simd_length(outward) > distance * 0.04 { outward = simd_normalize(outward) }
      else { outward = SIMD3(cos(angle), 0, sin(angle)) }
      // A small fan keeps coincident bolts visible; lifting keeps parts above the surface.
      let fan = SIMD3<Float>(cos(angle), 0, sin(angle)) * distance * 0.12
      let lift = distance * (0.22 + Float(index % 4) * 0.08)
      let offset = outward * distance * 0.6 + fan + SIMD3(0, lift, 0)
      let parentMatrix = entity.parent?.transformMatrix(relativeTo: content) ?? matrix_identity_float4x4
      let localOffset = simd_inverse(parentMatrix) * SIMD4(offset, 0)
      guard (0..<3).allSatisfy({ localOffset[$0].isFinite }) else { continue }
      let assembled = entity.transform
      var separated = assembled
      separated.translation += SIMD3(localOffset.x, localOffset.y, localOffset.z)
      let name = entity.name.isEmpty ? "Part \(index + 1)" : entity.name
      parts.append(Part(id: Self.identity(entity, relativeTo: content), label: Self.label(name)))
      placements.append(Placement(entity: entity, assembled: assembled, separated: separated,
        opacity: entity.components[OpacityComponent.self]))
    }
    self.parts = parts
    self.placements = placements
  }

  /// Playback completion settles a unit; an explicit forward command can finish the current step.
  @discardableResult
  func apply(assembledCount: Int, exploded: Bool, animated: Bool,
    requestId: Double = 0, scene: Scene? = nil) -> Int {
    let target = min(parts.count, max(0, assembledCount))
    guard previousTarget != target || previousExploded != exploded || self.requestId != requestId else {
      return settledCount
    }
    let wasComplete = showingComplete
    let finishCurrent = requestId != self.requestId && exploded && previousExploded == true
      && !showingComplete && !active.isEmpty && settledCount < (previousTarget ?? settledCount)
      && target >= (previousTarget ?? target)
    let completedTarget = finishCurrent ? previousTarget : nil
    cancel(emitIdle: false)
    if let completedTarget { settledCount = completedTarget }
    showingComplete = wasComplete
    restore()
    previousTarget = target
    previousExploded = exploded
    self.requestId = requestId
    if !animated || scene == nil {
      settledCount = target
      showingComplete = !exploded
      restore()
      emit("idle")
      return settledCount
    }
    let token = generation
    subscription = scene!.subscribe(to: AnimationEvents.PlaybackCompleted.self) { [weak self] event in
      Task { @MainActor [weak self] in
        guard let self, self.generation == token,
          let index = self.active.first(where: { $0.value == event.playbackController })?.key else { return }
        self.active.removeValue(forKey: index)
        if self.showingComplete != !exploded {
          if self.active.isEmpty {
            self.showingComplete = !exploded
            self.restore()
            self.finish()
          }
        } else {
          guard self.active.isEmpty else { return }
          self.settledCount = self.activeEnd
          self.restore()
          self.advance(to: target)
        }
      }
    }
    if showingComplete != !exploded {
      emit("previewing")
      let visibleEnd = nextUnitEnd
      for (index, placement) in placements.enumerated() where index >= settledCount {
        placement.entity.isEnabled = !exploded || index < visibleEnd
        if exploded && index >= visibleEnd {
          placement.entity.transform = placement.separated
          continue
        }
        active[index] = placement.entity.move(to: exploded ? placement.separated : placement.assembled,
          relativeTo: placement.entity.parent, duration: Self.animationDuration, timingFunction: .easeInOut)
      }
      if active.isEmpty { showingComplete = !exploded; restore(); finish() }
    } else {
      advance(to: target)
    }
    return settledCount
  }

  func cancel() { cancel(emitIdle: true) }

  private func cancel(emitIdle: Bool) {
    generation += 1
    subscription?.cancel()
    subscription = nil
    let controllers = Array(active.values)
    active.removeAll()
    controllers.forEach { $0.stop() }
    placements.forEach { $0.entity.stopAllAnimations(recursive: false) }
    showingComplete = previousExploded == false
    restore()
    if emitIdle { emit("idle") }
  }

  private func advance(to target: Int) {
    guard settledCount != target else { finish(); return }
    let forward = target > settledCount
    let range = unit(containing: forward ? settledCount : settledCount - 1)
    let start = forward ? settledCount : max(target, range.lowerBound)
    let end = forward ? min(target, range.upperBound) : settledCount
    activeEnd = forward ? end : start
    if !forward {
      for index in settledCount..<placements.count { placements[index].entity.isEnabled = false }
    }
    emit(forward ? "assembling" : "separating")
    for index in start..<end {
      let placement = placements[index]
      placement.entity.isEnabled = true
      active[index] = placement.entity.move(to: forward ? placement.assembled : placement.separated,
        relativeTo: placement.entity.parent, duration: Self.animationDuration, timingFunction: .easeInOut)
    }
  }

  private var nextUnitEnd: Int {
    settledCount < placements.count ? unit(containing: settledCount).upperBound : placements.count
  }

  private func unit(containing index: Int) -> Range<Int> {
    guard let family = Self.repeatedFamily(placements[index].entity.name) else { return index..<index + 1 }
    var start = index
    var end = index + 1
    while start > 0 && Self.repeatedFamily(placements[start - 1].entity.name) == family { start -= 1 }
    while end < placements.count && Self.repeatedFamily(placements[end].entity.name) == family { end += 1 }
    return start..<end
  }

  // Only authored runs of repeated fasteners or valve springs move together.
  private static func repeatedFamily(_ name: String) -> String? {
    if name.hasPrefix("pistonBolt") || name.hasPrefix("pistonNut") { return "pistonFasteners" }
    for prefix in ["crankHolderBolt", "engineSideBolt", "cylinderHeadBolt", "cylinderHeadSpring"] {
      if name.hasPrefix(prefix) { return prefix }
    }
    return nil
  }

  private func finish() {
    subscription?.cancel()
    subscription = nil
    emit("idle")
  }

  private func restore() {
    for (index, placement) in placements.enumerated() {
      placement.entity.isEnabled = showingComplete || index < nextUnitEnd
      let target = showingComplete || index < settledCount ? placement.assembled : placement.separated
      // Replace the component to clear a stopped animation's bound presentation pose.
      placement.entity.components.remove(Transform.self)
      placement.entity.components.set(target)
      if let opacity = placement.opacity { placement.entity.components.set(opacity) }
      else { placement.entity.components.remove(OpacityComponent.self) }
    }
  }

  private func emit(_ phase: String) {
    onChange?(Snapshot(assembledCount: settledCount, requestId: requestId, phase: phase))
  }

  private static func hasGeometry(_ entity: Entity) -> Bool {
    entity.components[ModelComponent.self] != nil || entity.children.contains(where: hasGeometry)
  }

  private static func independentParts(in entity: Entity) -> [Entity] {
    if entity.components[ModelComponent.self] != nil { return [entity] }
    let children = entity.children.filter(hasGeometry)
    if children.count == 1 { return independentParts(in: children[0]) }
    return children
  }

  private static func label(_ name: String) -> String {
    name.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
      .replacingOccurrences(of: "([A-Za-z])([0-9])", with: "$1 $2", options: .regularExpression)
      .replacingOccurrences(of: "_", with: " ")
      .trimmingCharacters(in: .whitespaces)
      .capitalized
  }

  private static func identity(_ entity: Entity, relativeTo content: Entity) -> String {
    var names: [String] = []
    var current: Entity? = entity
    while let node = current, node !== content {
      let siblings = node.parent.map { Array($0.children) } ?? [node]
      let index = siblings.firstIndex(where: { $0 === node }) ?? 0
      names.append("\(node.name.isEmpty ? "part" : node.name)[\(index)]")
      current = node.parent
    }
    return names.reversed().joined(separator: "/")
  }
}

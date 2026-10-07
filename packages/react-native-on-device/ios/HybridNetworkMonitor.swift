import Network
import NitroModules

final class HybridNetworkMonitor: HybridNetworkMonitorSpec {
  private let queue = DispatchQueue(label: HybridNetworkMonitor.queueLabel)
  private var monitor: NWPathMonitor?
  private static let queueLabel = "dev.splatfieldguide.network"
  private static let unknown = -1.0

  func start(onChange: @escaping (NetworkPath) -> Void) throws {
    queue.sync {
      monitor?.cancel()
      let next = NWPathMonitor()
      monitor = next
      next.pathUpdateHandler = { [weak self, weak next] path in
        guard let self, let next, self.monitor === next else { return }
        let satisfied = path.status == .satisfied
        let transport: NetworkTransport = !satisfied ? .none
          : path.usesInterfaceType(.wifi) ? .wifi
          : path.usesInterfaceType(.cellular) ? .cellular
          : path.usesInterfaceType(.wiredEthernet) ? .wired : .other
        onChange(NetworkPath(satisfied: satisfied, transport: transport,
          expensive: path.isExpensive, constrained: path.isConstrained,
          downstreamKbps: Self.unknown, signalLevel: Self.unknown))
      }
      // The first path update is the current route, after the monitor starts observing it.
      next.start(queue: queue)
    }
  }

  func stop() throws {
    queue.sync {
      monitor?.cancel()
      monitor = nil
    }
  }

  deinit { monitor?.cancel() }
}

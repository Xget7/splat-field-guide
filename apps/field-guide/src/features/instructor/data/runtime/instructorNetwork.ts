import type { Platform } from '../../../../platform/ports';
import {
  NetworkQuality,
  Transport,
  type NetworkStatus,
} from '../../../../platform/connectivity/networkStatus';
import { createQualityEstimator } from '../../../../platform/connectivity/networkQuality';
import {
  createNetworkService,
  type NetworkService,
} from '../../../../platform/connectivity/networkService';
import { NO_PROXY_REASON } from '../../domain/mode/modeCopy';
import type { ProxyClient } from '../proxy/proxyClient';

export interface InstructorNetworkOptions {
  readonly platform: Pick<Platform, 'networkMonitor' | 'timers' | 'random'>;
  /** Without a proxy Claude is never reachable, so the instructor stays offline. */
  readonly proxy: ProxyClient | null;
  /** The status screens show. */
  readonly onShown: (status: NetworkStatus) => void;
  /** The status the instructor's mode follows. */
  readonly onMode: (status: NetworkStatus) => void;
}

const NO_PROXY_STATUS: NetworkStatus = {
  quality: NetworkQuality.offline,
  transport: Transport.none,
  reason: NO_PROXY_REASON,
};

/**
 * The network the instructor follows: probed through the Worker, or offline for good without a
 * proxy while screens still show the device's route.
 */
export function createInstructorNetwork({
  platform,
  proxy,
  onShown,
  onMode,
}: InstructorNetworkOptions): NetworkService {
  const paths = platform.networkMonitor;
  if (proxy === null) {
    const pathQuality = createQualityEstimator();
    return {
      start() {
        onMode(NO_PROXY_STATUS);
        paths.start(path => onShown(pathQuality.path(path)));
      },
      stop: () => paths.stop(),
      setActive() {},
      setForeground() {},
      report() {},
    };
  }
  return createNetworkService({
    paths,
    probe: proxy.ping,
    timers: platform.timers,
    random: platform.random,
    emit(status) {
      onShown(status);
      onMode(status);
    },
  });
}

import type { Cancel, Random, Timers } from '../../../../platform/ports';
import {
  createBackoff,
  type BackoffLimits,
} from '../../../../platform/connectivity/backoff';
import { NetworkQuality } from '../../../../platform/connectivity/networkStatus';

/** Waits before reconnecting a conversation that fell back to the device voice. */
export const AgentRetry: BackoffLimits = { initialMs: 2000, maxMs: 60000 };

export interface AgentReconnectOptions {
  readonly timers: Timers;
  readonly random: Random;
  /** Whether a conversation may move to the agent now; checked when a retry is due. */
  readonly canReconnect: () => boolean;
  readonly reconnect: () => void;
}

/** When a conversation that fell back to the device voice tries the agent again. */
export interface AgentReconnect {
  /** The conversation fell back to the device voice; the next retry waits for the backoff. */
  fellBack(): void;
  /** The agent answered, so the backoff starts again. */
  connected(): void;
  /** Every network status; a later good one is a new or recovered route and retries at once. */
  networkChanged(quality: NetworkQuality): void;
  /** A due retry waits until no turn is running. */
  setIdle(idle: boolean): void;
  /** Drops a pending or due retry. */
  cancel(): void;
}

export function createAgentReconnect({
  timers,
  random,
  canReconnect,
  reconnect,
}: AgentReconnectOptions): AgentReconnect {
  const backoff = createBackoff(AgentRetry, random);
  let cancelWait: Cancel | null = null;
  let due = false;
  let idle = true;
  let routeSeen = false;
  function cancel() {
    cancelWait?.();
    cancelWait = null;
    due = false;
  }
  function retry() {
    if (!due || !idle) {
      return;
    }
    due = false;
    if (canReconnect()) {
      reconnect();
    }
  }
  return {
    fellBack() {
      if (cancelWait !== null) {
        return;
      }
      cancelWait = timers.after(backoff.next(), () => {
        cancelWait = null;
        due = true;
        retry();
      });
    },
    connected() {
      cancel();
      backoff.reset();
    },
    networkChanged(quality) {
      const changed = routeSeen;
      routeSeen = true;
      if (changed && quality === NetworkQuality.good) {
        cancel();
        backoff.reset();
        due = true;
        retry();
      }
    },
    setIdle(value) {
      idle = value;
      retry();
    },
    cancel,
  };
}

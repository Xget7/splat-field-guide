import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Raw conversation audio through one echo-cancelled graph: microphone chunks out, remote speech in.
 * Audio crosses the bridge as base64 of little-endian 16-bit mono PCM.
 */
export interface AudioLink
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Opens the microphone and player; onInput receives 100 ms chunks at inputRate.
   * onLevel receives smoothed levels from 0 to 1 at most 30 times a second.
   * onStopped receives the reason when the system takes audio away (call, Siri, route loss).
   * Rejects when not permitted, or when speech input is already listening.
   */
  start(
    inputRate: number,
    outputRate: number,
    onInput: (chunk: string) => void,
    onLevel: (level: number) => void,
    onStopped: (reason: string) => void,
  ): Promise<void>;
  /** Queues a chunk at outputRate after everything already queued. */
  play(chunk: string): void;
  /** Drops queued and playing audio at once and resets playedMs to 0. */
  clear(): void;
  /** Milliseconds of queued audio played since start or the last clear. */
  playedMs(): number;
  /** Closes microphone and player. Safe when stopped. */
  stop(): void;
}

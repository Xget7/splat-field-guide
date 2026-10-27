import {
  SwitchStepState,
  type SwitchPiece,
  type SwitchStep,
} from './modeTypes';
import type { Cancel, Clock, Timers } from '../../../../platform/ports';

export const SwitchTiming = {
  MIN_SWITCH_MS: 600,
  PIECE_TIMEOUT_MS: 8000,
} as const;
export interface SwitchPieceTask {
  readonly piece: SwitchPiece;
  readonly label: string;
  readonly fallbackLabel: string;
  readonly start: () => Promise<boolean>;
}
export type SwitchOutcome = Readonly<Partial<Record<SwitchPiece, boolean>>>;
export async function runSwitch(
  switchId: number,
  tasks: readonly SwitchPieceTask[],
  emit: (step: SwitchStep) => void,
  ports: { readonly clock: Clock; readonly timers: Timers },
): Promise<SwitchOutcome> {
  const { clock, timers } = ports;
  const began = clock();
  const outcome: Partial<Record<SwitchPiece, boolean>> = {};
  tasks.forEach(task =>
    emit({
      switchId,
      piece: task.piece,
      state: SwitchStepState.starting,
      label: task.label,
    }),
  );
  await Promise.all(
    tasks.map(async task => {
      let cancelTimeout: Cancel | undefined;
      const timeout = new Promise<boolean>(resolve => {
        cancelTimeout = timers.after(SwitchTiming.PIECE_TIMEOUT_MS, () =>
          resolve(false),
        );
      });
      let ready = false;
      try {
        ready = await Promise.race([
          Promise.resolve().then(task.start),
          timeout,
        ]);
      } catch {
        ready = false;
      } finally {
        cancelTimeout?.();
      }
      outcome[task.piece] = ready;
      emit({
        switchId,
        piece: task.piece,
        state: ready ? SwitchStepState.ready : SwitchStepState.fallback,
        label: ready ? task.label : task.fallbackLabel,
      });
    }),
  );
  const remaining = SwitchTiming.MIN_SWITCH_MS - (clock() - began);
  if (remaining > 0) {
    await new Promise<void>(resolve => timers.after(remaining, resolve));
  }
  return outcome;
}

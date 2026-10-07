import {
  SwitchStepState,
  type SwitchPiece,
  type SwitchStep,
} from '../../events/types';

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
  timing?: { now: () => number; delay: (ms: number) => Promise<void> },
): Promise<SwitchOutcome> {
  const now = timing?.now ?? Date.now;
  const delay =
    timing?.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const began = now();
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = timing
        ? timing.delay(SwitchTiming.PIECE_TIMEOUT_MS).then(() => false)
        : new Promise<boolean>(resolve => {
            timer = setTimeout(
              () => resolve(false),
              SwitchTiming.PIECE_TIMEOUT_MS,
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
        clearTimeout(timer);
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
  const remaining = SwitchTiming.MIN_SWITCH_MS - (now() - began);
  if (remaining > 0) {
    await delay(remaining);
  }
  return outcome;
}

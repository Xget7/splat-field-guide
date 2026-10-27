import type {
  Cancel,
  Clock,
  SpeechInput,
  SpeechOutput,
  Timers,
} from '../../../../platform/ports';
import type { Pack } from '../../../pack/pack';
import type { Answerer } from '../turn/answerer';
import {
  SpeechAvailability,
  SpeechVoice,
  VOICE_LOCALE,
} from '../voice/voiceCopy';
import {
  UtteranceKind,
  utteranceId,
  type Utterance,
} from '../voice/voiceSession';
import { ModeAnnouncement, SwitchLabel } from './modeCopy';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  SwitchPiece,
  SwitchStepState,
  VoiceSource,
  type ModeSources,
  type ModeStatus,
  type SwitchStep,
} from './modeTypes';

export const SwitchTiming = {
  MIN_SWITCH_MS: 600,
  PIECE_TIMEOUT_MS: 8000,
} as const;

/** The device voice offline mode speaks with, and the switch step that names it. */
export interface OfflineVoice {
  readonly voice: SpeechVoice;
  readonly label: string;
}
/** Kokoro runs only on iOS; other platforms speak offline with the system voice. */
export const OfflineVoices = {
  kokoro: { voice: SpeechVoice.kokoro, label: SwitchLabel.kokoro },
  system: { voice: SpeechVoice.system, label: SwitchLabel.systemVoice },
} as const satisfies Record<string, OfflineVoice>;

export interface ModeSwitchingOptions {
  readonly clock: Clock;
  readonly timers: Timers;
  readonly input: () => SpeechInput;
  readonly output: () => SpeechOutput;
  readonly offlineVoice: OfflineVoice;
  /** Prepared for offline answers, and the fallback when Claude cannot be reached online. */
  readonly device: Answerer;
  readonly pack: () => Pack | null;
  /** Prepares the agent conversation, resolving whether online voice can start. */
  readonly prepareAgent: () => Promise<boolean>;
  /** Reaches the Worker, rejecting when Claude cannot answer. */
  readonly probe: () => Promise<number>;
  readonly onStep: (step: SwitchStep) => void;
}

/** The mode a switch settles in and the sources it found ready. */
export interface SwitchResult {
  readonly mode: typeof InstructorMode.online | typeof InstructorMode.offline;
  readonly sources: ModeSources;
}

export interface ModeSwitching {
  /**
   * Runs the switch a switching mode starts, reporting every step, and resolves its result, or
   * null once a newer switch or cancel supersedes it.
   */
  begin(mode: InstructorMode): Promise<SwitchResult | null>;
  /** The spoken notice for an offline mode the network caused, numbered by the latest switch. */
  announcementFor(status: ModeStatus): Utterance | null;
  /** Supersedes the running switch and cancels its waits. */
  cancel(): void;
}

interface PieceTask {
  readonly piece: SwitchPiece;
  readonly label: string;
  readonly fallbackLabel: string;
  readonly start: () => Promise<boolean>;
}
type Outcome = Partial<Record<SwitchPiece, boolean>>;

export function createModeSwitching(
  options: ModeSwitchingOptions,
): ModeSwitching {
  const { clock, timers, offlineVoice, device } = options;
  let switchId = 0;
  let supersede: (() => void) | null = null;
  // Waits are tracked so cancel stops the ones still pending.
  const waits = new Set<Cancel>();
  function after(delayMs: number, run: () => void) {
    const cancel = timers.after(delayMs, () => {
      waits.delete(cancel);
      run();
    });
    waits.add(cancel);
    return () => {
      waits.delete(cancel);
      cancel();
    };
  }
  function tasksFor(mode: InstructorMode): readonly PieceTask[] {
    if (mode === InstructorMode.switchingToOffline) {
      return [
        {
          piece: SwitchPiece.voice,
          label: offlineVoice.label,
          fallbackLabel: SwitchLabel.systemVoice,
          start: async () =>
            (await options.output().prepare(offlineVoice.voice)) ===
            offlineVoice.voice,
        },
        {
          piece: SwitchPiece.answers,
          label: SwitchLabel.deviceModel,
          fallbackLabel: SwitchLabel.script,
          start: async () => {
            const pack = options.pack();
            if (pack) {
              device.prewarm(pack);
            }
            return device.isReady();
          },
        },
        {
          piece: SwitchPiece.listening,
          label: SwitchLabel.deviceListening,
          fallbackLabel: SwitchLabel.noListening,
          start: async () =>
            (await options.input().prepare(VOICE_LOCALE)) ===
            SpeechAvailability.available,
        },
      ];
    }
    return [
      {
        piece: SwitchPiece.voice,
        label: SwitchLabel.agentVoice,
        fallbackLabel: SwitchLabel.deviceVoice,
        start: options.prepareAgent,
      },
      {
        piece: SwitchPiece.answers,
        label: SwitchLabel.claude,
        fallbackLabel: SwitchLabel.deviceModel,
        start: async () => {
          await options.probe();
          return true;
        },
      },
    ];
  }
  function deviceAnswers() {
    return device.isReady() ? AnswerSource.deviceModel : AnswerSource.script;
  }
  function resultFor(mode: InstructorMode, outcome: Outcome): SwitchResult {
    if (mode === InstructorMode.switchingToOffline) {
      return {
        mode: InstructorMode.offline,
        sources: {
          voice: VoiceSource.device,
          answers: outcome.answers
            ? AnswerSource.deviceModel
            : AnswerSource.script,
        },
      };
    }
    return {
      mode: InstructorMode.online,
      sources: {
        voice: outcome.voice ? VoiceSource.agent : VoiceSource.device,
        answers: outcome.answers ? AnswerSource.claude : deviceAnswers(),
      },
    };
  }
  /** Starts every piece at once, each falling back on failure or timeout, and keeps the switch visible for a minimum time. */
  async function run(
    id: number,
    tasks: readonly PieceTask[],
    current: () => boolean,
  ): Promise<Outcome> {
    const report = (step: SwitchStep) => {
      if (current()) {
        options.onStep(step);
      }
    };
    const began = clock();
    const outcome: Outcome = {};
    tasks.forEach(task =>
      report({
        switchId: id,
        piece: task.piece,
        state: SwitchStepState.starting,
        label: task.label,
      }),
    );
    await Promise.all(
      tasks.map(async task => {
        let cancelTimeout: Cancel | undefined;
        const timeout = new Promise<boolean>(resolve => {
          cancelTimeout = after(SwitchTiming.PIECE_TIMEOUT_MS, () =>
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
        report({
          switchId: id,
          piece: task.piece,
          state: ready ? SwitchStepState.ready : SwitchStepState.fallback,
          label: ready ? task.label : task.fallbackLabel,
        });
      }),
    );
    const remaining = SwitchTiming.MIN_SWITCH_MS - (clock() - began);
    if (remaining > 0) {
      await new Promise<void>(resolve => after(remaining, resolve));
    }
    return outcome;
  }
  function cancel() {
    switchId++;
    supersede?.();
    supersede = null;
    [...waits].forEach(stop => stop());
  }
  return {
    begin(mode) {
      supersede?.();
      const id = ++switchId;
      const current = () => id === switchId;
      const superseded = new Promise<null>(resolve => {
        supersede = () => resolve(null);
      });
      return Promise.race([
        run(id, tasksFor(mode), current).then(outcome =>
          current() ? resultFor(mode, outcome) : null,
        ),
        superseded,
      ]);
    },
    announcementFor(status) {
      if (
        status.mode !== InstructorMode.offline ||
        status.cause !== ModeCause.network
      ) {
        return null;
      }
      return {
        id: utteranceId(UtteranceKind.notice, switchId),
        kind: UtteranceKind.notice,
        reply:
          status.answers === AnswerSource.deviceModel
            ? ModeAnnouncement.deviceModel
            : ModeAnnouncement.script,
        caution: '',
        stepKey: null,
      };
    },
    cancel,
  };
}

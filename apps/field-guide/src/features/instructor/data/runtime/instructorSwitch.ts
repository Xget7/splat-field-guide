import type { SpeechInput, SpeechOutput } from '../../../../platform/ports';
import {
  AnswerSource,
  InstructorMode,
  SwitchPiece,
  VoiceSource,
  type ModeSources,
  type ModeStatus,
} from '../../domain/mode/modeTypes';
import type { Pack } from '../../../pack/pack';
import type { InstructorModel } from '../../domain/turn/InstructorModel';
import type {
  SwitchOutcome,
  SwitchPieceTask,
} from '../../domain/mode/modeSwitcher';
import { ModeAnnouncement, SwitchLabel } from '../../domain/mode/modeCopy';
import {
  SpeechAvailability,
  SpeechVoice,
  VOICE_LOCALE,
} from '../../domain/voice/voiceCopy';
import {
  UtteranceKind,
  utteranceId,
  type Utterance,
} from '../../domain/voice/voiceSession';

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
interface SwitchDependencies {
  input: () => SpeechInput;
  output: () => SpeechOutput;
  offlineVoice: OfflineVoice;
  model: InstructorModel;
  pack: Pack | null;
  prepareAgent(): Promise<boolean>;
  probe(): Promise<number>;
}
export function switchTasks(
  target: InstructorMode,
  deps: SwitchDependencies,
): readonly SwitchPieceTask[] {
  if (target === InstructorMode.switchingToOffline) {
    return [
      {
        piece: SwitchPiece.voice,
        label: deps.offlineVoice.label,
        fallbackLabel: SwitchLabel.systemVoice,
        start: async () =>
          (await deps.output().prepare(deps.offlineVoice.voice)) ===
          deps.offlineVoice.voice,
      },
      {
        piece: SwitchPiece.answers,
        label: SwitchLabel.deviceModel,
        fallbackLabel: SwitchLabel.script,
        start: async () => {
          if (deps.pack) {
            deps.model.prewarm(deps.pack);
          }
          return deps.model.isReady();
        },
      },
      {
        piece: SwitchPiece.listening,
        label: SwitchLabel.deviceListening,
        fallbackLabel: SwitchLabel.noListening,
        start: async () =>
          (await deps.input().prepare(VOICE_LOCALE)) ===
          SpeechAvailability.available,
      },
    ];
  }
  return [
    {
      piece: SwitchPiece.voice,
      label: SwitchLabel.agentVoice,
      fallbackLabel: SwitchLabel.deviceVoice,
      start: deps.prepareAgent,
    },
    {
      piece: SwitchPiece.answers,
      label: SwitchLabel.claude,
      fallbackLabel: SwitchLabel.deviceModel,
      start: async () => {
        await deps.probe();
        return true;
      },
    },
  ];
}
export function switchSources(
  target: InstructorMode,
  outcome: SwitchOutcome,
  model: InstructorModel,
): ModeSources {
  if (target === InstructorMode.switchingToOffline) {
    return {
      voice: VoiceSource.device,
      answers: outcome.answers ? AnswerSource.deviceModel : AnswerSource.script,
    };
  }
  let answers: ModeSources['answers'] = AnswerSource.claude;
  if (!outcome.answers) {
    answers = model.isReady() ? AnswerSource.deviceModel : AnswerSource.script;
  }
  return {
    voice: outcome.voice ? VoiceSource.agent : VoiceSource.device,
    answers,
  };
}
export function offlineAnnouncement(
  status: ModeStatus,
  switchId: number,
): Utterance {
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
}

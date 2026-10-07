import { ConnectionFailure } from '../../events/types';
import type { Pack } from '../../pack/pack';
import type { SessionEvent, SessionState } from '../../guide/session';
import type { PreviousExchange } from '../grounding';
import type { TurnEvent } from '../turn';
import type { SpokenSection, SpokenWord } from './speechPresentation';

export const UtteranceKind = {
  step: 'step',
  answer: 'answer',
  notice: 'notice',
} as const;
export type UtteranceKind = (typeof UtteranceKind)[keyof typeof UtteranceKind];
export interface Utterance {
  /** A new id is said again even when its text has not changed. */
  readonly id: string;
  readonly kind: UtteranceKind;
  readonly reply: string;
  readonly caution: string;
  readonly stepKey: string | null;
}
export interface VoiceContext {
  readonly pack: Pack;
  readonly state: SessionState;
  readonly history: readonly PreviousExchange[];
  readonly thinking: boolean;
  /** A model question that has not received any reply text yet. */
  readonly pendingQuestion?: string | null;
  /** Automatic restarts may check recognition assets but cannot request their installation. */
  readonly allowSpeechInstall?: boolean;
}
export const VoiceStartFailure = {
  permission: 'permission',
  unavailable: 'unavailable',
  failed: 'failed',
  ...ConnectionFailure,
} as const;
export type VoiceStartFailure =
  (typeof VoiceStartFailure)[keyof typeof VoiceStartFailure];
export class VoiceStartError extends Error {
  constructor(readonly failure: VoiceStartFailure) {
    super(failure);
  }
}
export const VoiceEnd = {
  silence: 'silence',
  goodbye: 'goodbye',
  stopped: 'stopped',
  ...ConnectionFailure,
  audio: 'audio',
  lost: 'lost',
} as const;
export type VoiceEnd = (typeof VoiceEnd)[keyof typeof VoiceEnd];
export interface VoiceSessionEvents {
  listening(open: boolean): void;
  transcript(text: string): void;
  speaking(section: SpokenSection | null): void;
  word(word: SpokenWord | null): void;
  level(level: number): void;
  hint(text: string): void;
  question(text: string): void;
  cancelQuestion(): void;
  turn(event: TurnEvent): void;
  action(event: SessionEvent): void;
  ended(reason: VoiceEnd, pending: string | null): void;
}
export interface VoiceSession {
  start(context: VoiceContext, events: VoiceSessionEvents): Promise<void>;
  say(utterance: Utterance): Promise<void>;
  update(context: VoiceContext): void;
  interrupt(): void;
  setMuted(muted: boolean): void;
  /** Stops without calling ended. Safe twice. */
  stop(): string | null;
}

export type VoicePrompt = <T>(request: () => Promise<T>) => Promise<T>;

export interface TypedQuestions {
  ask(text: string): boolean;
}
export interface VoiceConnection {
  readonly session: VoiceSession;
  readonly questions: TypedQuestions | null;
}
export function stepKeyFor(state: SessionState): string {
  return `${state.procedureId}:${state.stepIndex}:${state.selectedPart}`;
}
const UtterancePrefix = {
  step: 'step:',
  answer: 'answer:',
  notice: 'mode:',
} as const;
export function utteranceId(kind: UtteranceKind, key: string | number): string {
  return UtterancePrefix[kind] + key;
}
export interface VoiceRuntimeState {
  readonly revision: number;
  readonly canStart: boolean;
  readonly foreground: boolean;
  readonly announcement: Utterance | null;
}
export interface VoiceRuntime {
  voiceSnapshot(): VoiceRuntimeState;
  subscribeVoice(listener: () => void): () => void;
  sessionFor(pack: Pack): VoiceConnection | null;
}

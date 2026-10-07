import type { Pack } from '../../pack/pack';
import type { SessionEvent, SessionState } from '../../guide/session';
import type { PreviousExchange } from '../grounding';
import type { TurnEvent } from '../turn';
import type { SpokenSection, SpokenWord } from './speechPresentation';

export const VoiceSessionKind = {
  agent: 'agent',
  pipeline: 'pipeline',
} as const;
export type VoiceSessionKind =
  (typeof VoiceSessionKind)[keyof typeof VoiceSessionKind];
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
}
export const VoiceStartFailure = {
  permission: 'permission',
  unavailable: 'unavailable',
  failed: 'failed',
  quota: 'quota',
  auth: 'auth',
  network: 'network',
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
  stopped: 'stopped',
  network: 'network',
  quota: 'quota',
  auth: 'auth',
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
  readonly kind: VoiceSessionKind;
  start(context: VoiceContext, events: VoiceSessionEvents): Promise<void>;
  say(utterance: Utterance): Promise<void>;
  ask(text: string): boolean;
  update(context: VoiceContext): void;
  interrupt(): void;
  setMuted(muted: boolean): void;
  /** Stops without calling ended. Safe twice. */
  stop(): void;
}

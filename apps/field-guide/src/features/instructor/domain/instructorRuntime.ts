import type { Pack } from '../../pack/pack';
import type { ModeRequest } from './mode/modeTypes';
import type { TurnRunner } from './turn/turnRunner';
import type { VoiceRuntime } from './voice/voiceSession';

/** What the app and its screens hold of the running instructor. */
export interface InstructorRuntime extends VoiceRuntime {
  readonly instructor: TurnRunner;
  setPack(pack: Pack): void;
  setInstructorOpen(open: boolean): void;
  setIdle(idle: boolean): void;
  /** Applies a user choice about the suggested mode; ignored outside start and stop. */
  requestMode(request: ModeRequest): void;
  start(): void;
  stop(): void;
}

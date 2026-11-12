import type { PreviousExchange } from './grounding';
import type { OfflineModels } from 'react-native-on-device';
import type { Pack } from '../../pack/pack';
import type { ModeRequest } from './mode/modeTypes';
import type { TurnRunner } from './turn/turnRunner';
import type { VoiceRuntime } from './voice/voiceSession';

/**
 * What the app and its screens hold of the running instructor. It sits apart from its
 * composition so the store can hold one without importing what reports to it.
 */
export interface Instructor extends VoiceRuntime {
  readonly turns: TurnRunner;
  historyFor(pack: Pack): readonly PreviousExchange[];
  readonly offlineModels?: OfflineModels;
  setPack(pack: Pack): void;
  setInstructorOpen(open: boolean): void;
  setIdle(idle: boolean): void;
  /** Applies a user choice about the suggested mode; ignored outside start and stop. */
  requestMode(request: ModeRequest): void;
  start(): void;
  stop(): void;
}

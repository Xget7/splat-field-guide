import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  NetworkQuality,
  NetworkReason,
  Transport,
  type NetworkStatus,
} from '../../../platform/connectivity/networkStatus';
import { AgentState, type AgentStatus } from '../domain/agent/agentStatus';
import type { Instructor } from '../domain/instructorHandle';
import {
  isSwitching,
  ModeRequestType,
  STARTUP_MODE,
  type ModeStatus,
  type ModeSuggestion,
  type SwitchStep,
} from '../domain/mode/modeTypes';
import { activeSwitchSteps, mergeSwitchStep } from '../domain/mode/switchSteps';
import type { VoiceRuntimeState } from '../domain/voice/voiceSession';

const UNKNOWN_NETWORK: NetworkStatus = {
  quality: NetworkQuality.good,
  transport: Transport.other,
  reason: NetworkReason.unknown,
};
const IDLE_AGENT: AgentStatus = { state: AgentState.idle, reason: null };
// Until an instructor reports, a foreground voice may start.
const READY_VOICE: VoiceRuntimeState = {
  revision: 0,
  canStart: true,
  foreground: true,
  announcement: null,
};

/** What the instructor last reported, and the instructor screens talk to. */
export interface InstructorStatus {
  readonly network: NetworkStatus;
  readonly mode: ModeStatus;
  readonly suggestion: ModeSuggestion | null;
  readonly agent: AgentStatus;
  /** Steps of the latest switch, kept from before its switching mode arrives. */
  readonly switchSteps: readonly SwitchStep[];
  /** The latest switch whose mode settled, so its steps stop showing. */
  readonly settledSwitchId: number | null;
  readonly voice: VoiceRuntimeState;
  readonly instructor: Instructor | null;
}

export interface InstructorActions {
  networkChanged(network: NetworkStatus): void;
  modeChanged(mode: ModeStatus): void;
  switchStepArrived(step: SwitchStep): void;
  suggestionChanged(suggestion: ModeSuggestion | null): void;
  agentChanged(agent: AgentStatus): void;
  voiceChanged(voice: VoiceRuntimeState): void;
  acceptSuggestion(): void;
  dismissSuggestion(): void;
  attach(instructor: Instructor): void;
  reset(): void;
}

export type InstructorState = InstructorStatus & InstructorActions;
export type InstructorStore = StoreApi<InstructorState>;

const INITIAL_STATUS: InstructorStatus = {
  network: UNKNOWN_NETWORK,
  mode: STARTUP_MODE,
  suggestion: null,
  agent: IDLE_AGENT,
  switchSteps: [],
  settledSwitchId: null,
  voice: READY_VOICE,
  instructor: null,
};

/** The switch steps to show; the same array while they do not change. */
export function selectSwitchSteps(state: InstructorStatus) {
  return activeSwitchSteps(state.switchSteps, state.settledSwitchId);
}

export function createInstructorStore(): InstructorStore {
  return createStore<InstructorState>()((set, get) => ({
    ...INITIAL_STATUS,
    networkChanged: network => set({ network }),
    modeChanged: mode =>
      set(state => ({
        mode,
        settledSwitchId:
          isSwitching(state.mode.mode) && !isSwitching(mode.mode)
            ? state.switchSteps[0]?.switchId ?? state.settledSwitchId
            : state.settledSwitchId,
      })),
    switchStepArrived: step =>
      set(state => ({ switchSteps: mergeSwitchStep(state.switchSteps, step) })),
    suggestionChanged: suggestion => set({ suggestion }),
    agentChanged: agent => set({ agent }),
    voiceChanged: voice => set({ voice }),
    acceptSuggestion: () =>
      get().instructor?.requestMode({ type: ModeRequestType.acceptSuggestion }),
    dismissSuggestion: () =>
      get().instructor?.requestMode({
        type: ModeRequestType.dismissSuggestion,
      }),
    attach: instructor => {
      if (get().instructor !== instructor) {
        set({ instructor });
      }
    },
    reset: () => set(INITIAL_STATUS),
  }));
}

/** The app's one instructor store, which the React hooks read. */
export const instructorStore = createInstructorStore();

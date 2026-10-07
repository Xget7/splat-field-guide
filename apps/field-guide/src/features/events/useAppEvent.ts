import { useSyncExternalStore } from 'react';
import { appEvents } from './bus';
import { activeSwitchSteps, mergeSwitchStep } from './switchSteps';
import { isSwitching } from './mode';
import {
  AgentState,
  AnswerSource,
  InstructorMode,
  ModeCause,
  NetworkQuality,
  NetworkReason,
  Transport,
  VoiceSource,
  type AgentStatus,
  type AppEvents,
  type ModeStatus,
  type NetworkStatus,
  type SwitchStep,
} from './types';

const UNKNOWN_NETWORK: NetworkStatus = {
  quality: NetworkQuality.good,
  transport: Transport.other,
  reason: NetworkReason.unknown,
};
const STARTUP_MODE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
  forced: false,
};
const IDLE_AGENT: AgentStatus = { state: AgentState.idle, reason: null };

export function useAppEvent<K extends keyof AppEvents>(
  type: K,
  fallback: AppEvents[K],
): AppEvents[K] {
  const snapshot = () => appEvents.latest(type) ?? fallback;
  return useSyncExternalStore(
    listener => appEvents.on(type, listener),
    snapshot,
    snapshot,
  );
}
export function useNetwork() {
  return useAppEvent('network', UNKNOWN_NETWORK);
}
export function useInstructorMode() {
  return useAppEvent('mode', STARTUP_MODE);
}
export function useModeSuggestion() {
  return useAppEvent('modeSuggestion', null);
}
export function useAgentStatus() {
  return useAppEvent('agent', IDLE_AGENT);
}

let steps: readonly SwitchStep[] = [];
let settledSwitchId: number | null = null;
// Steps arrive before the switching card mounts, so retain them from module load.
appEvents.on('switchStep', step => {
  steps = mergeSwitchStep(steps, step);
});
appEvents.on('mode', status => {
  if (!isSwitching(status.mode)) {
    settledSwitchId = steps[0]?.switchId ?? settledSwitchId;
  }
});
export function useSwitchSteps(): readonly SwitchStep[] {
  const snapshot = () => activeSwitchSteps(steps, settledSwitchId);
  return useSyncExternalStore(
    listener => {
      const unsubscribeStep = appEvents.on('switchStep', listener);
      const unsubscribeMode = appEvents.on('mode', listener);
      return () => {
        unsubscribeStep();
        unsubscribeMode();
      };
    },
    snapshot,
    snapshot,
  );
}

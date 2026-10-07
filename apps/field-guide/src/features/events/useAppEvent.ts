import { useSyncExternalStore } from 'react';
import { appEvents } from './bus';
import { mergeSwitchStep } from './switchSteps';
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
// Steps arrive before the switching card mounts, so retain them from module load.
appEvents.on('switchStep', step => {
  steps = mergeSwitchStep(steps, step);
});
export function useSwitchSteps(): readonly SwitchStep[] {
  const snapshot = () => steps;
  return useSyncExternalStore(
    listener => appEvents.on('switchStep', listener),
    snapshot,
    snapshot,
  );
}

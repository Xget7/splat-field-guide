import { useStore } from 'zustand';
import type { InstructorRuntime } from '../domain/instructorRuntime';
import { instructorStore, selectSwitchSteps } from './instructorStore';

const MISSING_RUNTIME = 'App must provide the instructor runtime';

export function useNetwork() {
  return useStore(instructorStore, state => state.network);
}
export function useInstructorMode() {
  return useStore(instructorStore, state => state.mode);
}
export function useModeSuggestion() {
  return useStore(instructorStore, state => state.suggestion);
}
export function useAgentStatus() {
  return useStore(instructorStore, state => state.agent);
}
export function useSwitchSteps() {
  return useStore(instructorStore, selectSwitchSteps);
}
export function useVoiceRuntime() {
  return useStore(instructorStore, state => state.voice);
}
export function useInstructorRuntime(): InstructorRuntime {
  const runtime = useStore(instructorStore, state => state.runtime);
  if (runtime === null) {
    throw new Error(MISSING_RUNTIME);
  }
  return runtime;
}

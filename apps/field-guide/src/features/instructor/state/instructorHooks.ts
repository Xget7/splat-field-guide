import { useStore } from 'zustand';
import type { Instructor } from '../domain/instructorHandle';
import { instructorStore, selectSwitchSteps } from './instructorStore';

const MISSING_INSTRUCTOR = 'App must provide the instructor';

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
export function useInstructor(): Instructor {
  const instructor = useStore(instructorStore, state => state.instructor);
  if (instructor === null) {
    throw new Error(MISSING_INSTRUCTOR);
  }
  return instructor;
}

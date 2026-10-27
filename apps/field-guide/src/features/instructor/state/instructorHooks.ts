import { useStore } from 'zustand';
import type { Instructor } from '../domain/instructorHandle';
import {
  assistantStatusFor,
  voiceStatusFor,
  type AssistantStatus,
  type VoiceActivity,
  type VoiceStatus,
} from '../domain/instructorStatus';
import { modeViewFor, type ModeView } from '../domain/modeView';
import { instructorStore, selectSwitchSteps } from './instructorStore';

const MISSING_INSTRUCTOR = 'App must provide the instructor';

export function useNetwork() {
  return useStore(instructorStore, state => state.network);
}
export function useInstructorMode() {
  return useStore(instructorStore, state => state.mode);
}
export function useModeView(): ModeView {
  return modeViewFor(useInstructorMode());
}
/** What the voice is doing, or null while voice is off. */
export function useVoiceStatus(voice: VoiceActivity): VoiceStatus | null {
  const { voice: source } = useInstructorMode();
  return voice.on ? voiceStatusFor(voice, source) : null;
}
export function useAssistantStatus(voice: VoiceActivity): AssistantStatus {
  const { mode, voice: source } = useInstructorMode();
  return assistantStatusFor(voice, mode, source);
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

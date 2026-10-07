import {
  useInstructorMode,
  useModeSuggestion,
} from '../../../features/events/useAppEvent';
import { InstructorMode } from '../../../features/events/types';
import { ModeNotice } from './ModeNotice';
import { ModeSuggestion } from './ModeSuggestion';
import { SwitchingCard } from './SwitchingCard';

export function ModeArea() {
  const status = useInstructorMode();
  const suggestion = useModeSuggestion();
  if (
    status.mode === InstructorMode.switchingToOffline ||
    status.mode === InstructorMode.switchingToOnline
  ) {
    return <SwitchingCard status={status} />;
  }
  if (suggestion !== null && status.mode === InstructorMode.online) {
    return <ModeSuggestion />;
  }
  return <ModeNotice status={status} />;
}

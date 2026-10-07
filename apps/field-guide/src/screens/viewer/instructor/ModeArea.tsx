import { useModeSuggestion } from '../../../features/events/useAppEvent';
import { InstructorMode } from '../../../features/events/types';
import { isSwitching } from '../../../features/events/mode';
import { useModeView } from './useModeView';
import { ModeNotice } from './ModeNotice';
import { ModeSuggestion } from './ModeSuggestion';
import { SwitchingCard } from './SwitchingCard';

export function ModeArea() {
  const view = useModeView();
  const suggestion = useModeSuggestion();
  if (isSwitching(view.mode)) {
    return <SwitchingCard title={view.switchTitle} />;
  }
  if (suggestion !== null && view.mode === InstructorMode.online) {
    return <ModeSuggestion />;
  }
  return <ModeNotice notice={view.notice} />;
}

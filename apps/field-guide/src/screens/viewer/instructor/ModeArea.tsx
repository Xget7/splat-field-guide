import { useModeSuggestion } from '../../../features/events/useAppEvent';
import { InstructorMode } from '../../../features/events/types';
import { isSwitching } from '../../../features/events/mode';
import { SuggestionCopy } from '../../../features/instructor/mode/modeCopy';
import { Color } from '../../../ui/theme';
import { useModeView } from './useModeView';
import { ModeNotice } from './ModeNotice';
import { ModeSuggestion } from './ModeSuggestion';
import { SwitchingCard } from './SwitchingCard';
import { ModeBanner } from './ModeBanner';

export function ModeArea() {
  const view = useModeView();
  const suggestion = useModeSuggestion();
  const switching = isSwitching(view.mode);
  const suggested = suggestion !== null && view.mode === InstructorMode.online;
  const banner = switching
    ? {
        contentKey: view.switchTitle,
        ruleColor: Color.accent,
        content: <SwitchingCard title={view.switchTitle} />,
      }
    : suggested
    ? {
        contentKey: SuggestionCopy.title,
        ruleColor: Color.caution,
        content: <ModeSuggestion />,
      }
    : view.notice !== null
    ? {
        contentKey: view.notice.detail,
        ruleColor: view.notice.ruleColor,
        content: <ModeNotice notice={view.notice} />,
      }
    : null;
  if (banner === null) {
    return null;
  }
  return (
    <ModeBanner contentKey={banner.contentKey} ruleColor={banner.ruleColor}>
      {banner.content}
    </ModeBanner>
  );
}

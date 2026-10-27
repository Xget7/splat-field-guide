import { useModeSuggestion } from '../state/useAppEvent';
import { InstructorMode } from '../../../platform/connectivity/networkStatus';
import { isSwitching } from '../domain/mode/modeTypes';
import { SuggestionCopy } from '../domain/mode/modeCopy';
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
        // The header already says Offline.
        content: (
          <ModeNotice
            notice={view.notice}
            titled={view.mode !== InstructorMode.offline}
          />
        ),
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

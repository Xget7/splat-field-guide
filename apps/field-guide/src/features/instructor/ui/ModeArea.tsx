import { StyleSheet, Text } from 'react-native';
import { Color, Type } from '../../../ui/theme';
import { NoticeTone, type Notice } from '../domain/modeView';
import { isSwitching, InstructorMode } from '../domain/mode/modeTypes';
import { SuggestionCopy } from '../domain/mode/modeCopy';
import { useModeSuggestion, useModeView } from '../state/instructorHooks';
import { ModeSuggestion } from './ModeSuggestion';
import { SwitchingCard } from './SwitchingCard';
import { ModeBanner } from './ModeBanner';

const RULE_COLOR: Readonly<Record<NoticeTone, string>> = {
  [NoticeTone.plain]: Color.lineStrong,
  [NoticeTone.caution]: Color.caution,
};

function ModeNotice({
  notice,
  titled = true,
}: {
  notice: Notice;
  titled?: boolean;
}) {
  return (
    <>
      {titled && <Text style={styles.title}>{notice.title}</Text>}
      <Text style={styles.detail}>{notice.detail}</Text>
    </>
  );
}

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
        ruleColor: RULE_COLOR[view.notice.tone],
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

const styles = StyleSheet.create({
  title: { ...Type.calloutStrong, color: Color.text },
  detail: { ...Type.footnote, color: Color.secondaryText },
});

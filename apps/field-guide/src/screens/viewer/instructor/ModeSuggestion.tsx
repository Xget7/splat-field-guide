import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from 'react-native-reanimated';
import { appEvents } from '../../../features/events/bus';
import { ModeRequestType } from '../../../features/events/types';
import { SuggestionCopy } from '../../../features/instructor/mode/modeCopy';
import { Button, ButtonVariant } from '../../../ui/Button';
import { Color, Motion, Space, Type } from '../../../ui/theme';

const RULE = 2;
const ENTER = FadeIn.duration(Motion.base);
const EXIT = FadeOut.duration(Motion.base);

export function ModeSuggestion() {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reducedMotion ? undefined : ENTER}
      exiting={reducedMotion ? undefined : EXIT}
      style={styles.suggestion}
    >
      <Text style={styles.title}>{SuggestionCopy.title}</Text>
      <Text style={styles.detail}>{SuggestionCopy.body}</Text>
      <View style={styles.actions}>
        <Button
          label={SuggestionCopy.accept}
          onPress={() =>
            appEvents.emit('modeRequest', {
              type: ModeRequestType.acceptSuggestion,
            })
          }
        />
        <Button
          label={SuggestionCopy.dismiss}
          variant={ButtonVariant.secondary}
          onPress={() =>
            appEvents.emit('modeRequest', {
              type: ModeRequestType.dismissSuggestion,
            })
          }
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  suggestion: {
    borderLeftWidth: RULE,
    borderLeftColor: Color.caution,
    paddingLeft: Space.md,
    paddingVertical: Space.sm,
    gap: Space.xs,
  },
  title: { ...Type.calloutStrong, color: Color.text },
  detail: { ...Type.footnote, color: Color.secondaryText },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    marginTop: Space.sm,
  },
});

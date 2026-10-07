import { StyleSheet, Text, View } from 'react-native';
import { appEvents } from '../../../features/events/bus';
import { AppEvent, ModeRequestType } from '../../../features/events/types';
import { SuggestionCopy } from '../../../features/instructor/mode/modeCopy';
import { Button, ButtonVariant } from '../../../ui/Button';
import { Color, Space, Type } from '../../../ui/theme';

export function ModeSuggestion() {
  return (
    <>
      <Text style={styles.title}>{SuggestionCopy.title}</Text>
      <Text style={styles.detail}>{SuggestionCopy.body}</Text>
      <View style={styles.actions}>
        <Button
          label={SuggestionCopy.accept}
          onPress={() =>
            appEvents.emit(AppEvent.modeRequest, {
              type: ModeRequestType.acceptSuggestion,
            })
          }
        />
        <Button
          label={SuggestionCopy.dismiss}
          variant={ButtonVariant.secondary}
          onPress={() =>
            appEvents.emit(AppEvent.modeRequest, {
              type: ModeRequestType.dismissSuggestion,
            })
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.calloutStrong, color: Color.text },
  detail: { ...Type.footnote, color: Color.secondaryText },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    marginTop: Space.sm,
  },
});

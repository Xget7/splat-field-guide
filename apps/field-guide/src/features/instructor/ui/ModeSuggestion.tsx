import { StyleSheet, Text, View } from 'react-native';
import { instructorStore } from '../state/instructorStore';
import { SuggestionCopy } from '../domain/mode/modeCopy';
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
          onPress={() => instructorStore.getState().acceptSuggestion()}
        />
        <Button
          label={SuggestionCopy.dismiss}
          variant={ButtonVariant.secondary}
          onPress={() => instructorStore.getState().dismissSuggestion()}
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

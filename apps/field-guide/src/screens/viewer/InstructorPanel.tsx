import { useCallback, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { IconButton, IconButtonVariant, IconName, Label } from '../../ui/kit';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Radius,
  Space,
  Type,
} from '../../ui/theme';
import { CautionNote } from './CautionNote';

const STATUS_DOT = 6;
const CHIP_HEIGHT = 32;
// A chip is shorter than a finger; its touch area is not.
const CHIP_SLOP = (MIN_TOUCH - CHIP_HEIGHT) / 2;
// The splat keeps most of the screen even for a long answer.
const MAX_PANEL_SHARE = '55%';

/** What the panel shows: the last question, if any, and the answer to it. */
export interface InstructorMessage {
  readonly question: string | null;
  readonly reply: string;
  readonly caution: string;
}

interface Props {
  message: InstructorMessage;
  /** "Step 02 / 05", or null outside a procedure. */
  step: string | null;
  suggestions: readonly string[];
  bottomInset: number;
  onAsk: (question: string) => void;
}

/**
 * Ask in words, see the part. Answers come from the pack's own text; the reply replaces the
 * last one instead of piling up a chat, so the panel stays the same height.
 */
export function InstructorPanel({
  message,
  step,
  suggestions,
  bottomInset,
  onAsk,
}: Props) {
  const [draft, setDraft] = useState('');
  const send = useCallback(() => {
    if (draft.trim() === '') {
      return;
    }
    onAsk(draft);
    setDraft('');
    // Down goes the keyboard so the part it shows is in view.
    Keyboard.dismiss();
  }, [draft, onAsk]);

  return (
    <View
      testID="instructor-panel"
      style={[styles.panel, { paddingBottom: bottomInset + Space.md }]}
    >
      <View style={styles.header}>
        <View style={styles.status}>
          <View style={styles.dot} />
          <Label color={Color.accent}>Instructor</Label>
        </View>
        {step !== null && <Label color={Color.faint}>{step}</Label>}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.text}>
        {message.question !== null && (
          <Text testID="instructor-question" style={styles.question}>
            {`> ${message.question}`}
          </Text>
        )}
        <Text
          testID="instructor-reply"
          accessibilityLiveRegion="polite"
          style={styles.reply}
        >
          {message.reply}
        </Text>
        {message.caution !== '' && <CautionNote text={message.caution} />}
      </ScrollView>
      {suggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.rail}
          contentContainerStyle={styles.suggestions}
        >
          {suggestions.map(suggestion => (
            <Pressable
              key={suggestion}
              testID={`suggestion-${suggestion}`}
              accessibilityRole="button"
              hitSlop={CHIP_SLOP}
              onPress={() => onAsk(suggestion)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
            >
              <Text style={styles.chipText}>{suggestion}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={styles.inputRow}>
        <TextInput
          testID="instructor-input"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder="Ask about a part"
          placeholderTextColor={Color.faint}
          returnKeyType="send"
          enablesReturnKeyAutomatically
          autoCorrect={false}
          keyboardAppearance="dark"
          selectionColor={Color.accent}
          accessibilityLabel="Ask the instructor"
          style={styles.input}
        />
        <IconButton
          testID="instructor-send"
          icon={IconName.send}
          accessibilityLabel="Send"
          variant={
            draft.trim() === ''
              ? IconButtonVariant.raised
              : IconButtonVariant.active
          }
          disabled={draft.trim() === ''}
          onPress={send}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight: MAX_PANEL_SHARE,
    flexShrink: 1,
    paddingTop: Space.lg,
    paddingHorizontal: Space.lg,
    gap: Space.md,
    backgroundColor: Color.black,
    borderTopWidth: HAIRLINE,
    borderTopColor: Color.line,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dot: { width: STATUS_DOT, height: STATUS_DOT, backgroundColor: Color.accent },
  scroll: { flexGrow: 0, flexShrink: 1 },
  text: { gap: Space.sm },
  question: { ...Type.data, color: Color.muted },
  reply: { ...Type.body, color: Color.text },
  // Runs to the screen edges so a chip cut off there reads as more to scroll to.
  rail: { flexGrow: 0, marginHorizontal: -Space.lg },
  suggestions: { gap: Space.sm, paddingHorizontal: Space.lg },
  chip: {
    height: CHIP_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  pressed: { backgroundColor: Color.pressed },
  chipText: { ...Type.footnote, color: Color.secondaryText },
  inputRow: { flexDirection: 'row', gap: Space.sm },
  input: {
    ...Type.callout,
    flex: 1,
    height: MIN_TOUCH,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
    color: Color.text,
  },
});

import { useRef, type ComponentRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Icon, IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';

const SUGGESTIONS = [
  'Where is the A5 axis motor?',
  'What motion does axis A5 control?',
];
export function CourseComposer({
  onAsk,
  onVoice,
  voiceOn,
  onDocument,
  question,
  onQuestionChange,
}: {
  onAsk: (question: string) => void;
  onVoice?: () => void;
  voiceOn?: boolean;
  onDocument: () => void;
  question: string;
  onQuestionChange: (question: string) => void;
}) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const lift = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const send = () => {
    if (!question.trim()) {
      return;
    }
    if (!reduced) {
      Animated.sequence([
        Animated.timing(lift, {
          toValue: -8,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(lift, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
    }
    onAsk(question.trim());
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.composer}>
        <TextInput
          ref={input}
          testID="course-question"
          accessibilityLabel="Ask about this course"
          placeholder="Ask about this course…"
          placeholderTextColor={C.secondary}
          value={question}
          onChangeText={onQuestionChange}
          multiline
          style={styles.input}
        />
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open source document, KR QUANTEC extra.pdf"
            onPress={onDocument}
            style={styles.document}
          >
            <View style={styles.documentChip}>
              <Icon name={IconName.document} size={16} color={C.accent} />
              <Text numberOfLines={1} style={styles.filename}>
                KR QUANTEC extra.pdf
              </Text>
            </View>
          </Pressable>
          {onVoice && (
            <Pressable
              testID="course-voice"
              accessibilityRole="button"
              accessibilityLabel={voiceOn ? 'End voice' : 'Start voice'}
              onPress={onVoice}
              style={styles.voice}
            >
              <Icon
                name={voiceOn ? IconName.micOff : IconName.mic}
                color={C.text}
                size={20}
              />
            </Pressable>
          )}
          <Pressable
            testID="course-send"
            accessibilityRole="button"
            accessibilityLabel="Send question"
            accessibilityState={{ disabled: !question.trim() }}
            disabled={!question.trim()}
            onPress={send}
            style={[styles.send, !question.trim() && styles.disabled]}
          >
            <Animated.View style={{ transform: [{ translateY: lift }] }}>
              <Icon name={IconName.send} color={C.white} size={20} />
            </Animated.View>
          </Pressable>
        </View>
      </View>
      <View style={styles.suggestions}>
        {SUGGESTIONS.map(text => (
          <Pressable
            key={text}
            accessibilityRole="button"
            hitSlop={G.unit}
            onPress={() => {
              onQuestionChange(text);
              input.current?.focus();
            }}
            style={styles.suggestion}
          >
            <Text style={styles.prompt}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { gap: G.unit },
  composer: {
    minHeight: 280,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.card,
    backgroundColor: C.canvas,
    padding: G.small,
  },
  input: {
    ...T.body,
    color: C.text,
    // Account for the composer border so the suggestions end level with the preview.
    minHeight: 198,
    textAlignVertical: 'top',
    padding: 0,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: G.unit,
  },
  document: {
    minHeight: 44,
    maxWidth: 208,
    justifyContent: 'center',
    flexShrink: 1,
  },
  documentChip: {
    minHeight: G.large,
    paddingHorizontal: G.unit,
    gap: G.unit,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: G.unit,
    backgroundColor: C.raised,
  },
  filename: { ...T.caption, color: C.secondary, flexShrink: 1 },
  voice: {
    width: G.control,
    height: G.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    width: G.control,
    height: G.control,
    borderRadius: R.pill,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { backgroundColor: C.raised, opacity: 0.5 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: G.unit },
  suggestion: {
    minHeight: G.large,
    paddingHorizontal: G.unit,
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.control,
    justifyContent: 'center',
  },
  prompt: { fontSize: 11, lineHeight: 16, color: C.accent },
});

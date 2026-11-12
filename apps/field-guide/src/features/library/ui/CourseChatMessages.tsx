import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SessionStart } from '../../guide';
import { ExchangePhase, type Exchange } from '../../instructor';
import { ReplyText } from '../../instructor/views';
import { Icon, IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  CourseRadius as R,
  Grid as G,
} from '../../../ui/courseTokens';

export interface CourseChatTarget {
  readonly key: string;
  readonly title: string;
  readonly owner?: string;
  readonly start: SessionStart;
}

export interface CourseChatEntry {
  readonly exchange: Exchange;
  readonly targets: readonly CourseChatTarget[];
  readonly group?: SessionStart;
}

/** Unchanged rows keep their identity while the current answer streams. */
export const CourseChatMessage = memo(function ChatMessage({
  entry,
  latest,
  onOpen,
}: {
  entry: CourseChatEntry;
  latest: boolean;
  onOpen: (start: SessionStart) => void;
}) {
  const { exchange, targets, group } = entry;
  const complete = exchange.phase === ExchangePhase.done;
  return (
    <View testID={`course-exchange-${exchange.id}`} style={styles.exchange}>
      <View style={styles.questionBubble}>
        <Text selectable style={styles.question}>
          {exchange.question}
        </Text>
      </View>
      <View style={styles.answer}>
        {exchange.reply ? (
          <ReplyText
            id={latest ? 'course-answer' : `course-answer-${exchange.id}`}
            text={exchange.reply}
          />
        ) : (
          <Text accessibilityLiveRegion="polite" style={styles.secondary}>
            {exchange.interrupted ? 'Answer interrupted' : 'Thinking…'}
          </Text>
        )}
        {exchange.caution !== '' && (
          <Text style={styles.secondary}>{exchange.caution}</Text>
        )}
        {complete && !exchange.interrupted && targets.length > 0 && (
          <View style={styles.targets}>
            {targets.map(target => (
              <View key={target.key} style={styles.target}>
                <View style={styles.targetHeading}>
                  <Icon name={IconName.scene} size={20} color={C.accent} />
                  <View style={styles.targetName}>
                    <Text style={styles.title}>{target.title}</Text>
                    {target.owner && (
                      <Text style={styles.secondary}>{target.owner}</Text>
                    )}
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Navigate to 3D, ${target.title}`}
                  testID={`course-navigate-${exchange.id}-${target.key}`}
                  onPress={() => onOpen(target.start)}
                  style={({ pressed }) => [
                    styles.navigate,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.action}>Navigate to 3D</Text>
                  <Icon name={IconName.next} size={20} color={C.white} />
                </Pressable>
              </View>
            ))}
            {group && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Navigate to 3D, all suggested components"
                testID={`course-navigate-group-${exchange.id}`}
                onPress={() => onOpen(group)}
                style={({ pressed }) => [
                  styles.group,
                  pressed && styles.pressed,
                ]}
              >
                <Icon name={IconName.layers} size={20} color={C.accent} />
                <Text style={styles.title}>View together in 3D</Text>
                <Icon name={IconName.next} size={20} color={C.accent} />
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  exchange: { gap: G.medium },
  questionBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    padding: G.small,
    borderRadius: R.control,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.raised,
  },
  question: { ...T.body, color: C.text },
  answer: { alignSelf: 'stretch', gap: G.small },
  secondary: { ...T.caption, color: C.secondary },
  targets: { flexDirection: 'row', flexWrap: 'wrap', gap: G.small },
  target: {
    width: 288,
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.control,
    padding: G.small,
    gap: G.small,
    backgroundColor: C.surface,
  },
  targetHeading: { flexDirection: 'row', alignItems: 'center', gap: G.unit },
  targetName: { flex: 1, gap: G.unit },
  title: { ...T.label, color: C.text },
  navigate: {
    minHeight: G.control,
    paddingHorizontal: G.small,
    borderRadius: R.control,
    backgroundColor: C.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: G.unit,
  },
  action: { ...T.label, color: C.white },
  pressed: { opacity: 0.75 },
  group: {
    minHeight: G.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: G.unit,
    padding: G.small,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.control,
  },
});

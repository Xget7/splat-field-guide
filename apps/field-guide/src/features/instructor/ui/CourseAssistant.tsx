import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Pack } from '../../pack/pack';
import { INITIAL_SESSION, reduce, type SessionEvent } from '../../guide';
import {
  TurnEventType,
  type Exchange,
  type TurnEvent,
} from '../domain/turn/exchange';
import { useInstructor } from '../state/instructorHooks';
import { useInstructorVoice } from './useInstructorVoice';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
  CourseRadius as R,
} from '../../../ui/courseTokens';
import { Icon, IconName } from '../../../ui/Icon';

/** Course knowledge is available from the manifest before a scene is mounted. */
export function CourseAssistant({
  pack,
  initialQuestion,
  onNavigate,
  draft,
  onDraftChange,
  onDocument,
  visible = true,
}: {
  pack: Pack;
  initialQuestion?: string | null;
  onNavigate: (event: SessionEvent) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onDocument: () => void;
  visible?: boolean;
}) {
  const instructor = useInstructor();
  const [entries, setEntries] = useState<readonly Exchange[]>([]);
  const [session, setSession] = useState(INITIAL_SESSION);
  const [thinking, setThinking] = useState(false);
  const active = useRef(true);
  const initial = useRef<string | null>(null);
  const history = instructor.historyFor(pack);
  const action = (event: SessionEvent) => {
    setSession(current => reduce(current, event, pack));
    onNavigate(event);
  };
  const turn = (event: TurnEvent) => {
    if (!active.current) return;
    setThinking(
      event.type === TurnEventType.begin ||
        event.type === TurnEventType.partial,
    );
    if (event.type === TurnEventType.cancel) return;
    setEntries(current =>
      [
        ...current.filter(entry => entry.id !== event.exchange.id),
        event.exchange,
      ].slice(-30),
    );
    if (event.type === TurnEventType.answer && event.answer.event)
      action(event.answer.event);
  };
  const askText = (question: string) =>
    instructor.turns.ask(
      { question, pack, state: session, history: instructor.historyFor(pack) },
      turn,
    );
  const voice = useInstructorVoice({
    pack,
    enabled: visible,
    utterance: null,
    context: { pack, state: session, history, thinking },
    runtime: instructor,
    onAsk: question => {
      askText(question);
    },
    onCancel: () => instructor.turns.cancel(),
    onTurn: turn,
    onAction: action,
    onIdle: idle => instructor.setIdle(idle),
  });
  const ask = (question: string) => {
    if (!question.trim()) return;
    onDraftChange('');
    if (!voice.ask(question)) {
      askText(question);
    }
  };
  useEffect(() => {
    active.current = true;
    instructor.setPack(pack);
    instructor.setInstructorOpen(visible);
    return () => {
      active.current = false;
      instructor.turns.cancel();
      instructor.setInstructorOpen(false);
    };
  }, [instructor, pack, visible]);
  useEffect(() => {
    if (initialQuestion && initial.current !== initialQuestion) {
      initial.current = initialQuestion;
      askText(initialQuestion);
    }
    // A submitted question starts once; streaming renders must not submit it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);
  return (
    <View style={[styles.panel, !visible && styles.hidden]}>
      <Text accessibilityRole="header" style={styles.title}>
        Miris assistant
      </Text>
      {entries.map(entry => (
        <View key={entry.id} style={styles.exchange}>
          <Text style={styles.question}>{entry.question}</Text>
          {entry.reply ? (
            <Text selectable style={styles.reply}>
              {entry.reply}
            </Text>
          ) : (
            <Text style={styles.hint}>Thinking...</Text>
          )}
        </View>
      ))}
      {voice.transcript ? (
        <Text style={styles.hint}>{voice.transcript}</Text>
      ) : null}
      {voice.hint ? (
        <Text accessibilityRole="alert" style={styles.hint}>
          {voice.hint}
        </Text>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          testID="course-question"
          accessibilityLabel="Ask about Miris"
          placeholder="Ask about Miris..."
          placeholderTextColor={C.secondary}
          value={draft}
          onChangeText={onDraftChange}
          multiline
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={voice.on ? 'End voice' : 'Start voice'}
          onPress={voice.toggle}
          style={styles.button}
        >
          <Icon
            name={voice.on ? IconName.close : IconName.mic}
            color={C.text}
            size={24}
          />
        </Pressable>
        <Pressable
          testID="course-send"
          accessibilityRole="button"
          accessibilityLabel="Send question"
          disabled={!draft.trim()}
          onPress={() => ask(draft)}
          style={styles.button}
        >
          <Icon
            name={IconName.send}
            color={draft.trim() ? C.text : C.secondary}
            size={24}
          />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open source document, KR QUANTEC extra.pdf"
        onPress={onDocument}
      >
        <Text style={styles.hint}>KR QUANTEC extra.pdf</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  hidden: { display: 'none' },
  panel: { gap: G.medium, maxWidth: 800 },
  title: { ...T.heading, color: C.text },
  exchange: { gap: G.small },
  question: {
    ...T.body,
    color: C.text,
    backgroundColor: C.raised,
    padding: G.small,
    borderRadius: R.control,
  },
  reply: { ...T.body, color: C.text },
  hint: { ...T.caption, color: C.secondary },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: G.unit,
    padding: G.unit,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.control,
  },
  input: { ...T.body, color: C.text, flex: 1, minHeight: G.control },
  button: {
    width: G.control,
    height: G.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  INITIAL_SESSION,
  LearnMode,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionStart,
} from '../../guide';
import {
  ExchangePhase,
  InstructorMode,
  TurnEventType,
  type Exchange,
  type TurnEvent,
} from '../../instructor';
import {
  useInstructor,
  useInstructorMode,
  useInstructorVoice,
} from '../../instructor/views';
import type { ReadyGuide } from '../../pack/catalog';
import { assemblyOf } from '../../pack/graph';
import { findPart, findProcedure } from '../../pack/pack';
import { Icon, IconName } from '../../../ui/Icon';
import {
  CourseColor as C,
  CourseType as T,
  Grid as G,
} from '../../../ui/courseTokens';
import { CourseComposer } from './CourseComposer';
import { useWideLayout } from '../../../ui/useWideLayout';
import { useKeyboardVisible } from '../../../ui/useKeyboardVisible';
import {
  CourseChatMessage,
  type CourseChatEntry,
  type CourseChatTarget,
} from './CourseChatMessages';

const MAX_CHAT_ENTRIES = 60;

export interface CourseAssistantControls {
  toggleVoice(): void;
}
interface Props {
  guide: ReadyGuide | null;
  question: string | null;
  requestId?: number;
  voiceRequestId?: number;
  onOpen: (start: SessionStart) => void;
  onDocument: () => void;
  onBack?: () => void;
  active?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
  onVoiceChange?: (enabled: boolean) => void;
}

export const CourseAssistant = forwardRef<CourseAssistantControls, Props>(
  function CourseAssistantPanel(props, ref) {
    return props.guide ? (
      <ReadyCourseAssistant
        key={`${props.guide.pack.packId}/${props.guide.pack.packVersion}`}
        {...props}
        guide={props.guide}
        ref={ref}
      />
    ) : (
      <Text accessibilityRole="alert" style={styles.caption}>
        Install the course to ask about its equipment.
      </Text>
    );
  },
);

function proposals(
  exchange: Exchange,
  actions: readonly SessionEvent[],
  guide: ReadyGuide,
): Pick<CourseChatEntry, 'targets' | 'group'> {
  const targets = new Map<string, CourseChatTarget>();
  const parts = new Set<string>();
  const base = {
    guideId: guide.id,
    procedureId: null,
    stepIndex: 0,
    mode: LearnMode.selfGuided,
    voice: false,
  } as const;
  const addPart = (id: string) => {
    const part = findPart(guide.pack, id);
    if (!part) return;
    const owner = assemblyOf(guide.pack, id);
    parts.add(id);
    targets.set(`part-${id}`, {
      key: `part-${id}`,
      title: part.name,
      owner: owner && owner.id !== part.id ? owner.name : undefined,
      start: { ...base, selectedPart: id },
    });
  };
  if (exchange.part) addPart(exchange.part);
  for (const event of actions) {
    if (event.type === SessionEventType.select && event.partId) {
      addPart(event.partId);
    } else if (event.type === SessionEventType.selectParts) {
      event.partIds.forEach(addPart);
    } else if (event.type === SessionEventType.start) {
      const procedure = findProcedure(guide.pack, event.procedureId);
      if (procedure) {
        targets.set(`procedure-${procedure.id}`, {
          key: `procedure-${procedure.id}`,
          title: procedure.title,
          start: { ...base, procedureId: procedure.id },
        });
      }
    }
  }
  return {
    targets: [...targets.values()],
    group: parts.size > 1 ? { ...base, selectedParts: [...parts] } : undefined,
  };
}

/** The conversation stays mounted when the operator inspects a suggested 3D view. */
const ReadyCourseAssistant = forwardRef<
  CourseAssistantControls,
  Props & { guide: ReadyGuide }
>(function ReadyConversation(
  {
    guide,
    question,
    requestId,
    voiceRequestId,
    onOpen,
    onDocument,
    onBack,
    active = true,
    draft: controlledDraft,
    onDraftChange,
    onVoiceChange,
  },
  ref,
) {
  const instructor = useInstructor();
  const phone = !useWideLayout();
  const keyboardVisible = useKeyboardVisible();
  const mode = useInstructorMode();
  const focused = useIsFocused() && active;
  const [localDraft, setLocalDraft] = useState('');
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [session, setSession] = useState(INITIAL_SESSION);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [entries, setEntries] = useState<CourseChatEntry[]>(() =>
    instructor.historyFor(guide.pack).map((previous, index, all) => ({
      exchange: {
        ...previous,
        id: index - all.length,
        caution: '',
        part: null,
        phase: ExchangePhase.done,
      },
      targets: [],
    })),
  );
  const [error, setError] = useState('');
  const consumedQuestion = useRef<string | null>(null);
  const consumedVoice = useRef(0);
  const generation = useRef(0);
  const activeExchange = useRef<number | null>(null);
  const pending = useRef(false);
  const pendingActions = useRef<SessionEvent[]>([]);
  const scroll = useRef<FlatList<CourseChatEntry>>(null);
  const follow = useRef(true);
  const history = instructor.historyFor(guide.pack);
  const action = useCallback((event: SessionEvent) => {
    if (activeExchange.current !== null) pendingActions.current.push(event);
  }, []);
  const turn = useCallback(
    (event: TurnEvent) => {
      if (event.type === TurnEventType.cancel) {
        const id = activeExchange.current;
        activeExchange.current = null;
        pending.current = false;
        pendingActions.current = [];
        setExchange(null);
        setEntries(current =>
          current.map(entry =>
            entry.exchange.id === id
              ? {
                  exchange: {
                    ...entry.exchange,
                    interrupted: true,
                    phase: ExchangePhase.done,
                  },
                  targets: [],
                }
              : entry,
          ),
        );
        return;
      }
      if (event.type === TurnEventType.begin) {
        setEntries(current =>
          current.map(entry =>
            entry.exchange.phase === ExchangePhase.done
              ? entry
              : {
                  exchange: {
                    ...entry.exchange,
                    interrupted: true,
                    phase: ExchangePhase.done,
                  },
                  targets: [],
                },
          ),
        );
        pendingActions.current = [];
        activeExchange.current = event.exchange.id;
        pending.current = true;
        follow.current = true;
      } else if (activeExchange.current !== event.exchange.id) {
        return;
      }
      setExchange(event.exchange);
      let suggested: Pick<CourseChatEntry, 'targets' | 'group'> = {
        targets: [],
      };
      if (event.type === TurnEventType.answer) {
        pending.current = false;
        if (!event.exchange.interrupted) {
          if (event.answer.event) action(event.answer.event);
          suggested = proposals(event.exchange, pendingActions.current, guide);
        }
        pendingActions.current = [];
        activeExchange.current = null;
      }
      const next: CourseChatEntry = { exchange: event.exchange, ...suggested };
      setEntries(current => {
        const index = current.findIndex(
          entry => entry.exchange.id === next.exchange.id,
        );
        return (
          index < 0
            ? [...current, next]
            : current.map((entry, position) =>
                position === index ? next : entry,
              )
        ).slice(-MAX_CHAT_ENTRIES);
      });
    },
    [action, guide],
  );
  const askText = useCallback(
    (text: string, clearDraft = true) => {
      if (!focused || !text.trim()) return;
      const request = ++generation.current;
      if (clearDraft) setDraft('');
      setError('');
      pending.current = true;
      instructor.turns
        .ask(
          {
            navigation: 'proposal',
            question: text.trim(),
            pack: guide.pack,
            history: instructor.historyFor(guide.pack),
            state: session,
          },
          event => {
            if (request === generation.current) turn(event);
          },
        )
        .catch(() => {
          if (request === generation.current) {
            turn({ type: TurnEventType.cancel });
            setError('The answer could not be completed. Try again.');
          }
        });
    },
    [focused, guide.pack, instructor, session, setDraft, turn],
  );
  const voice = useInstructorVoice({
    pack: guide.pack,
    enabled: focused,
    utterance: null,
    context: {
      navigation: 'proposal',
      pack: guide.pack,
      state: session,
      history,
      thinking: exchange !== null && exchange.phase !== ExchangePhase.done,
    },
    runtime: instructor,
    onAsk: text => askText(text),
    onCancel: () => instructor.turns.cancel(),
    onTurn: turn,
    onAction: action,
    onIdle: idle => instructor.setIdle(idle),
  });
  useImperativeHandle(ref, () => ({ toggleVoice: voice.toggle }), [
    voice.toggle,
  ]);
  useEffect(() => onVoiceChange?.(voice.on), [onVoiceChange, voice.on]);
  const ask = (text: string, clearDraft = true) => {
    if (clearDraft) setDraft('');
    if (!voice.ask(text)) askText(text, false);
  };
  const latestAsk = useRef(ask);
  latestAsk.current = ask;
  useEffect(() => {
    if (
      focused &&
      question &&
      consumedQuestion.current !== String(requestId ?? question)
    ) {
      consumedQuestion.current = String(requestId ?? question);
      latestAsk.current(question, false);
    }
  }, [focused, question, requestId]);
  const toggleVoice = voice.toggle;
  useEffect(() => {
    if (focused && voiceRequestId && consumedVoice.current !== voiceRequestId) {
      consumedVoice.current = voiceRequestId;
      toggleVoice();
    }
  }, [focused, voiceRequestId, toggleVoice]);
  const cancelPending = useCallback(() => {
    generation.current++;
    if (pending.current) {
      instructor.turns.cancel();
      turn({ type: TurnEventType.cancel });
    }
    pending.current = false;
    activeExchange.current = null;
    pendingActions.current = [];
  }, [instructor, turn]);
  useEffect(() => {
    if (focused) {
      instructor.setInstructorOpen(true);
    }
    return () => {
      cancelPending();
      if (focused) instructor.setInstructorOpen(false);
    };
  }, [focused, guide.pack, instructor, cancelPending]);
  const open = useCallback(
    (start: SessionStart) => {
      if (!focused || start.guideId !== guide.id) return;
      if (start.selectedPart && !findPart(guide.pack, start.selectedPart))
        return;
      if (start.selectedParts?.some(id => !findPart(guide.pack, id))) return;
      if (start.procedureId && !findProcedure(guide.pack, start.procedureId))
        return;
      // A proposal becomes current context only after the operator chooses its card.
      if (start.selectedParts) {
        setSession(current =>
          reduce(
            current,
            {
              type: SessionEventType.selectParts,
              partIds: start.selectedParts!,
            },
            guide.pack,
          ),
        );
      } else if (start.selectedPart) {
        setSession(current =>
          reduce(
            current,
            { type: SessionEventType.select, partId: start.selectedPart! },
            guide.pack,
          ),
        );
      } else if (start.procedureId) {
        setSession(current =>
          reduce(
            current,
            { type: SessionEventType.start, procedureId: start.procedureId! },
            guide.pack,
          ),
        );
      }
      cancelPending();
      onOpen(start);
    },
    [focused, guide, onOpen, cancelPending],
  );
  const status =
    mode.mode === InstructorMode.online
      ? 'Online'
      : mode.mode === InstructorMode.offline
      ? 'Offline'
      : 'Connecting';
  return (
    <View testID="course-chat-screen" style={styles.panel}>
      <View
        testID="course-chat-header"
        style={[styles.header, phone && styles.phoneHeader]}
      >
        {onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to course"
            testID="course-chat-back"
            onPress={onBack}
            style={styles.control}
          >
            <Icon name={IconName.back} size={24} color={C.text} />
          </Pressable>
        )}
        <View style={[styles.heading, phone && styles.phoneHeading]}>
          <Text
            accessibilityRole="header"
            style={[styles.title, phone && styles.phoneTitle]}
          >
            Assistant
          </Text>
          <View style={styles.status}>
            <View
              style={[styles.dot, status === 'Online' && styles.connected]}
            />
            <Text testID="course-chat-status" style={styles.caption}>
              {status}
            </Text>
          </View>
        </View>
        {pending.current && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop answer"
            testID="course-chat-stop"
            onPress={cancelPending}
            style={styles.control}
          >
            <Icon name={IconName.stop} size={20} color={C.text} />
          </Pressable>
        )}
      </View>
      <FlatList
        ref={scroll}
        testID="course-chat-transcript"
        style={styles.transcript}
        contentContainerStyle={[styles.messages, phone && styles.phoneMessages]}
        data={entries}
        keyExtractor={entry => String(entry.exchange.id)}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        onScroll={({
          nativeEvent,
        }: NativeSyntheticEvent<NativeScrollEvent>) => {
          follow.current =
            nativeEvent.contentSize.height -
              nativeEvent.layoutMeasurement.height -
              nativeEvent.contentOffset.y <
            80;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (follow.current) scroll.current?.scrollToEnd({ animated: false });
        }}
        renderItem={({ item, index }) => (
          <CourseChatMessage
            entry={item}
            latest={index === entries.length - 1}
            onOpen={open}
          />
        )}
        ListFooterComponent={
          <>
            {voice.transcript ? (
              <Text style={styles.caption}>{voice.transcript}</Text>
            ) : null}
            {voice.hint ? (
              <Text accessibilityRole="alert" style={styles.caption}>
                {voice.hint}
              </Text>
            ) : null}
            {error !== '' && (
              <Text accessibilityRole="alert" style={styles.caption}>
                {error}
              </Text>
            )}
          </>
        }
      />
      <View style={[styles.footer, phone && styles.phoneFooter]}>
        <CourseComposer
          compact
          onAsk={ask}
          onDocument={onDocument}
          question={draft}
          onQuestionChange={setDraft}
          onVoice={voice.toggle}
          voiceOn={voice.on}
          showSuggestions={!phone || (entries.length === 0 && !keyboardVisible)}
        />
      </View>
    </View>
  );
});
const styles = StyleSheet.create({
  panel: { flex: 1 },
  header: {
    minHeight: 80,
    padding: G.small,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: G.unit,
  },
  heading: { flex: 1, gap: G.unit },
  phoneHeader: { minHeight: 56, padding: G.unit },
  phoneHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  phoneTitle: { ...T.body, fontWeight: '600' },
  title: { ...T.heading, color: C.text },
  caption: { ...T.caption, color: C.secondary },
  control: {
    width: G.control,
    height: G.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { flexDirection: 'row', alignItems: 'center', gap: G.unit },
  dot: {
    width: G.unit,
    height: G.unit,
    borderRadius: G.unit / 2,
    backgroundColor: C.secondary,
  },
  connected: { backgroundColor: C.accent },
  transcript: { flex: 1 },
  messages: { padding: G.medium, gap: G.large },
  phoneMessages: { padding: G.small, gap: G.medium },
  footer: { padding: G.small, borderTopWidth: 1, borderTopColor: C.border },
  phoneFooter: { padding: G.unit },
});

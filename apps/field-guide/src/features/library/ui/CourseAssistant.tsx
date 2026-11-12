import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
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
  TurnEventType,
  type Exchange,
  type TurnEvent,
} from '../../instructor';
import {
  ReplyText,
  useInstructor,
  useInstructorVoice,
} from '../../instructor/views';
import type { ReadyGuide } from '../../pack/catalog';
import { Button } from '../../../ui/Button';
import { Color, Space, Type } from '../../../ui/theme';
import { CourseComposer } from './CourseComposer';

export interface CourseAssistantControls {
  toggleVoice(): void;
}
interface Props {
  guide: ReadyGuide | null;
  question: string | null;
  requestId?: number;
  onOpen: (start: SessionStart) => void;
  onDocument: () => void;
  active?: boolean;
  inline?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
  onVoiceChange?: (enabled: boolean) => void;
}

export const CourseAssistant = forwardRef<CourseAssistantControls, Props>(
  function CourseAssistantPanel(props, ref) {
    return props.guide ? (
      <ReadyCourseAssistant {...props} guide={props.guide} ref={ref} />
    ) : (
      <Text accessibilityRole="alert" style={styles.caption}>
        Install the course to ask about its equipment.
      </Text>
    );
  },
);

/** One course conversation serves typed and spoken turns before a world is mounted. */
const ReadyCourseAssistant = forwardRef<
  CourseAssistantControls,
  Props & { guide: ReadyGuide }
>(function ReadyConversation(
  {
    guide,
    question,
    requestId,
    onOpen,
    onDocument,
    active = true,
    inline = false,
    draft: controlledDraft,
    onDraftChange,
    onVoiceChange,
  },
  ref,
) {
  const instructor = useInstructor();
  const focused = useIsFocused() && active;
  const [localDraft, setLocalDraft] = useState('');
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [session, setSession] = useState(INITIAL_SESSION);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState('');
  const consumedQuestion = useRef<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const navigation = useRef<SessionEvent | null>(null);
  const pendingActions = useRef<SessionEvent[]>([]);
  const history = instructor.historyFor(guide.pack);
  const action = useCallback((event: SessionEvent) => {
    pendingActions.current.push(event);
    if (
      event.type === SessionEventType.select ||
      event.type === SessionEventType.start
    )
      navigation.current = event;
  }, []);
  const turn = useCallback(
    (event: TurnEvent) => {
      if (event.type === TurnEventType.cancel) {
        pending.current = false;
        navigation.current = null;
        pendingActions.current = [];
        setExchange(null);
        return;
      }
      if (event.type === TurnEventType.begin) {
        pendingActions.current = [];
        navigation.current = null;
      }
      setExchange(event.exchange);
      if (event.type === TurnEventType.answer) {
        pending.current = false;
        if (event.exchange.interrupted) {
          navigation.current = null;
          pendingActions.current = [];
          return;
        }
        if (event.answer.event) action(event.answer.event);
        const accepted = pendingActions.current;
        pendingActions.current = [];
        setSession(current =>
          accepted.reduce(
            (state, item) => reduce(state, item, guide.pack),
            current,
          ),
        );
      }
    },
    [action, guide.pack],
  );
  const askText = useCallback(
    (text: string, clearDraft = true) => {
      if (!focused || !text.trim()) return;
      const request = ++generation.current;
      if (clearDraft) setDraft('');
      setError('');
      navigation.current = null;
      pendingActions.current = [];
      pending.current = true;
      instructor.turns
        .ask(
          {
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
            pending.current = false;
            navigation.current = null;
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
  const cancelPending = useCallback(() => {
    generation.current++;
    navigation.current = null;
    pendingActions.current = [];
    if (pending.current) instructor.turns.cancel();
    pending.current = false;
  }, [instructor]);
  useEffect(() => {
    if (focused) {
      instructor.setPack(guide.pack);
      instructor.setInstructorOpen(true);
    }
    return () => {
      cancelPending();
      instructor.setInstructorOpen(false);
    };
  }, [focused, guide.pack, instructor, cancelPending]);
  useEffect(() => {
    if (
      !focused ||
      exchange?.phase !== ExchangePhase.done ||
      exchange.interrupted ||
      voice.section !== null
    )
      return;
    const event = navigation.current;
    if (!event) return;
    navigation.current = null;
    if (event.type === SessionEventType.select && event.partId !== null) {
      onOpen({
        guideId: guide.id,
        procedureId: null,
        stepIndex: 0,
        mode: LearnMode.instructor,
        selectedPart: event.partId,
        voice: voice.on,
      });
    } else if (event.type === SessionEventType.start) {
      onOpen({
        guideId: guide.id,
        procedureId: event.procedureId,
        stepIndex: 0,
        mode: LearnMode.instructor,
        voice: voice.on,
      });
    }
  }, [exchange, focused, guide.id, onOpen, voice.on, voice.section]);
  const part = guide.pack.parts.find(item => item.id === exchange?.part);
  const tour = guide.pack.procedures[0];
  const partStep =
    tour?.steps.findIndex(step => step.parts.includes(part?.id ?? '')) ?? -1;
  return (
    <View style={styles.panel}>
      {!inline && (
        <Text accessibilityRole="header" style={styles.title}>
          Course assistant
        </Text>
      )}
      {exchange && (
        <View style={styles.answer}>
          <Text style={styles.question}>{exchange.question}</Text>
          {exchange.reply ? (
            <ReplyText id="course-answer" text={exchange.reply} />
          ) : (
            <Text accessibilityLiveRegion="polite" style={styles.caption}>
              Finding an answer...
            </Text>
          )}
          {exchange.caution !== '' && (
            <Text style={styles.caption}>{exchange.caution}</Text>
          )}
          {exchange.phase === ExchangePhase.done &&
            part &&
            tour &&
            partStep >= 0 && (
              <Button
                testID="course-answer-open"
                label={`Explore ${part.name}`}
                onPress={() =>
                  onOpen({
                    guideId: guide.id,
                    procedureId: tour.id,
                    stepIndex: partStep,
                    mode: LearnMode.instructor,
                    voice: false,
                  })
                }
              />
            )}
        </View>
      )}
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
      {!inline && (
        <CourseComposer
          onAsk={ask}
          onDocument={onDocument}
          question={draft}
          onQuestionChange={setDraft}
          onVoice={voice.toggle}
          voiceOn={voice.on}
        />
      )}
    </View>
  );
});
const styles = StyleSheet.create({
  panel: { gap: Space.lg, maxWidth: 800 },
  title: { ...Type.largeTitle, color: Color.text },
  caption: { ...Type.callout, color: Color.secondaryText },
  answer: {
    gap: Space.lg,
    padding: Space.xl,
    borderRadius: 16,
    backgroundColor: Color.raised,
  },
  question: { ...Type.calloutStrong, color: Color.accent },
});

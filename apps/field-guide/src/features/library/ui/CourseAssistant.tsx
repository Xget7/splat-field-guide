import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import { LearnMode, type SessionStart } from '../../guide';
import { ExchangePhase, TurnEventType, type Exchange } from '../../instructor';
import { ReplyText, useInstructor } from '../../instructor/views';
import type { ReadyGuide } from '../../pack/catalog';
import { Button } from '../../../ui/Button';
import { Color, Space, Type } from '../../../ui/theme';
import { CourseComposer } from './CourseComposer';

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
}

/** Course questions use the same grounded turn and cancellation contract as an activity. */
export function CourseAssistant({
  guide,
  question,
  requestId,
  onOpen,
  onDocument,
  active = true,
  inline = false,
  draft: controlledDraft,
  onDraftChange,
}: Props) {
  const instructor = useInstructor();
  const screenFocused = useIsFocused();
  const focused = screenFocused && active;
  const [localDraft, setLocalDraft] = useState('');
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const consumedQuestion = useRef<string | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  const ask = useCallback(
    (text: string, clearDraft = true) => {
      if (!guide || !focused || !text.trim()) return;
      const request = ++generation.current;
      if (clearDraft) setDraft('');
      setError('');
      pending.current = true;
      instructor.turns
        .ask(
          {
            question: text.trim(),
            pack: guide.pack,
            history: [],
            // The course has no active procedure or selected equipment to invent context from.
            state: { procedureId: null, stepIndex: 0, selectedPart: null },
          },
          event => {
            if (request !== generation.current) return;
            if (event.type === TurnEventType.cancel) {
              pending.current = false;
              setExchange(null);
            } else {
              setExchange(event.exchange);
              if (event.type === TurnEventType.answer) pending.current = false;
            }
          },
        )
        .catch(() => {
          if (request === generation.current) {
            pending.current = false;
            setError('The answer could not be completed. Try again.');
          }
        });
    },
    [focused, guide, instructor, setDraft],
  );

  useEffect(() => {
    if (
      focused &&
      question &&
      consumedQuestion.current !== String(requestId ?? question)
    ) {
      consumedQuestion.current = String(requestId ?? question);
      ask(question, false);
    }
    return () => {
      generation.current += 1;
      // Never cancel another screen's turn after this screen has already finished its own.
      if (pending.current) {
        instructor.turns.cancel();
        setExchange(null);
      }
      pending.current = false;
    };
  }, [ask, focused, instructor, question, requestId]);

  const part = guide?.pack.parts.find(item => item.id === exchange?.part);
  const tour = guide?.pack.procedures[0];
  const partStep =
    tour?.steps.findIndex(step => step.parts.includes(part?.id ?? '')) ?? -1;
  return (
    <View style={styles.panel}>
      {!inline && (
        <Text accessibilityRole="header" style={styles.title}>
          Course assistant
        </Text>
      )}
      {!guide && (
        <Text accessibilityRole="alert" style={styles.caption}>
          Install the course to ask about its equipment.
        </Text>
      )}
      {exchange && (
        <View style={styles.answer}>
          <Text style={styles.question}>{exchange.question}</Text>
          {exchange.reply ? (
            <ReplyText id="course-answer" text={exchange.reply} />
          ) : (
            <Text accessibilityLiveRegion="polite" style={styles.caption}>
              Finding an answer…
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
                    guideId: guide!.id,
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
        />
      )}
    </View>
  );
}

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

import { useEffect, useId, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Label } from '../../../ui/Label';
import { stepLabel } from '../../../ui/readout';
import {
  Color,
  HAIRLINE,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import { SpokenSection } from '../../../features/instructor/voice/speechPresentation';
import {
  VoiceState,
  type InstructorVoice,
} from '../../../features/instructor/voice/useInstructorVoice';
import type { CardContent } from '../guideContent';
import {
  EntryKind,
  ExchangePhase,
  type Exchange,
  type ThreadEntry,
} from '../viewerState';
import { CautionNote } from './CautionNote';
import { InstructorAnswer } from './InstructorAnswer';
import { FADE_IN, KaraokeText } from './InstructorMotion';

// Follow new words only near the end so reading older entries is not interrupted.
const FOLLOW_SLOP = Space.xl;
const DOT_SIZE = 6;
const DOT_COUNT = 3;
const DOT_DIM = 0.25;
const ThreadFade = {
  height: Type.footnote.lineHeight,
  start: '0%',
  end: '100%',
  opaque: 1,
  clear: 0,
} as const;

function entryLabel(card: CardContent): string {
  if (card.selected || card.stepCount === 0) {
    return card.title;
  }
  return stepLabel(card.stepNumber, card.stepCount);
}

function entryKey(entry: ThreadEntry): string {
  return entry.kind === EntryKind.step
    ? `step-${entry.id}`
    : `answer-${entry.exchange.id}`;
}

function Dot({ index, still }: { index: number; still: boolean }) {
  const opacity = useSharedValue(still ? 1 : DOT_DIM);
  useEffect(() => {
    if (!still) {
      opacity.value = withDelay(
        index * Motion.fast,
        withRepeat(
          withSequence(
            withTiming(1, { duration: Motion.base }),
            withTiming(DOT_DIM, { duration: Motion.base }),
          ),
          -1,
        ),
      );
    }
  }, [index, still, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

function Thinking({ still }: { still: boolean }) {
  return (
    <Animated.View
      testID="instructor-thinking"
      accessible
      accessibilityLabel="Thinking"
      entering={FADE_IN}
      style={styles.dots}
    >
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <Dot key={index} index={index} still={still} />
      ))}
    </Animated.View>
  );
}

interface SaidProps {
  reply: string;
  caution: string;
  /** Read the live entry aloud and show it in full color. */
  live: boolean;
  index: number;
  voice: InstructorVoice;
  streaming?: boolean;
  reducedMotion?: boolean;
  interrupted?: boolean;
}

function Said({
  reply,
  caution,
  live,
  index,
  voice,
  streaming = false,
  reducedMotion = true,
  interrupted = false,
}: SaidProps) {
  const speaking = live && voice.state === VoiceState.speaking;
  const answer =
    reply === '' && !interrupted ? null : (
      <InstructorAnswer
        id={live ? 'instructor-reply' : `thread-reply-${index}`}
        reply={reply}
        streaming={streaming && live}
        reducedMotion={reducedMotion}
        speaking={speaking && voice.section === SpokenSection.reply}
        word={voice.word}
        live={live}
        interrupted={interrupted}
      />
    );
  return (
    <>
      {answer}
      {caution !== '' &&
        (live ? (
          <CautionNote text={caution}>
            <KaraokeText
              id="instructor-caution-text"
              text={caution}
              speaking={speaking && voice.section === SpokenSection.caution}
              word={voice.word}
              style={Type.footnote}
            />
          </CautionNote>
        ) : (
          <CautionNote text={caution} />
        ))}
    </>
  );
}

interface Props {
  thread: readonly ThreadEntry[];
  exchange: Exchange | null;
  transcript: string;
  voice: InstructorVoice;
  reducedMotion: boolean;
  /** In compact mode, the step list shows the full step, so thread steps only mark questions. */
  compact?: boolean;
}

export function InstructorThread({
  thread,
  exchange,
  transcript,
  voice,
  reducedMotion,
  compact = false,
}: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const [scrolled, setScrolled] = useState(false);
  const wasScrolled = useRef(false);
  const gradientId = useId();
  const following = useRef(true);
  const entries: readonly ThreadEntry[] =
    exchange === null
      ? thread
      : [...thread, { kind: EntryKind.exchange, exchange }];
  const live = entries.length - 1;
  const listed = (entry: ThreadEntry) =>
    compact &&
    entry.kind === EntryKind.step &&
    entry.card.stepCount > 0 &&
    !entry.card.selected;
  const shown = entries.filter(
    (entry, index) =>
      !listed(entry) || entries[index + 1]?.kind === EntryKind.exchange,
  );
  // Bring a new entry into view even when the reader has scrolled back.
  const said = `${entries.length}:${transcript === ''}`;
  const seen = useRef(said);

  if (shown.length === 0 && transcript === '') {
    return null;
  }

  return (
    <View style={styles.fitted}>
      <ScrollView
        ref={scroll}
        testID="instructor-thread"
        style={styles.fitted}
        contentContainerStyle={styles.content}
        scrollEventThrottle={16}
        onScroll={({
          nativeEvent: { contentOffset, contentSize, layoutMeasurement },
        }) => {
          const nextScrolled = contentOffset.y > 0;
          if (nextScrolled !== wasScrolled.current) {
            wasScrolled.current = nextScrolled;
            setScrolled(nextScrolled);
          }
          following.current =
            contentOffset.y + layoutMeasurement.height >=
            contentSize.height - FOLLOW_SLOP;
        }}
        onLayout={() => {
          if (following.current) {
            scroll.current?.scrollToEnd({ animated: false });
          }
        }}
        onContentSizeChange={() => {
          if (following.current || seen.current !== said) {
            seen.current = said;
            following.current = true;
            scroll.current?.scrollToEnd({ animated: !reducedMotion });
          }
        }}
      >
        {entries.map((entry, index) =>
          !shown.includes(entry) ? null : listed(entry) ? (
            <View
              key={entryKey(entry)}
              testID={`thread-entry-${index}`}
              style={styles.divider}
            >
              <Label color={Color.faint}>
                {entry.kind === EntryKind.step && entryLabel(entry.card)}
              </Label>
              <View style={styles.rule} />
            </View>
          ) : (
            <Animated.View
              key={entryKey(entry)}
              testID={`thread-entry-${index}`}
              entering={FADE_IN}
              style={styles.entry}
            >
              {entry.kind === EntryKind.step ? (
                <>
                  <Text
                    testID={index === live ? 'instructor-title' : undefined}
                    accessibilityRole="header"
                    style={[styles.title, index !== live && styles.pastTitle]}
                  >
                    {entry.card.title}
                  </Text>
                  <Said
                    reply={entry.card.body}
                    caution={entry.card.caution}
                    live={index === live}
                    index={index}
                    voice={voice}
                  />
                </>
              ) : (
                <>
                  <Text
                    testID={
                      index === live
                        ? 'instructor-question'
                        : `thread-question-${index}`
                    }
                    style={[
                      styles.question,
                      index === live && styles.liveQuestion,
                    ]}
                  >
                    {entry.exchange.question}
                  </Text>
                  {entry.exchange.reply === '' &&
                  index === live &&
                  !entry.exchange.interrupted ? (
                    <Thinking still={reducedMotion} />
                  ) : (
                    <Said
                      reply={entry.exchange.reply}
                      caution={entry.exchange.caution}
                      live={index === live}
                      index={index}
                      voice={voice}
                      streaming={
                        entry.exchange.phase === ExchangePhase.streaming
                      }
                      reducedMotion={reducedMotion}
                      interrupted={entry.exchange.interrupted}
                    />
                  )}
                </>
              )}
            </Animated.View>
          ),
        )}
        {transcript !== '' && (
          <Text
            testID="instructor-transcript"
            accessibilityLabel={`Provisional transcript: ${transcript}`}
            style={[styles.question, styles.provisional]}
          >
            {transcript}
          </Text>
        )}
      </ScrollView>
      {scrolled && (
        <Svg
          testID="instructor-thread-top-fade"
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          width="100%"
          height={ThreadFade.height}
          style={styles.topFade}
        >
          <Defs>
            <LinearGradient
              id={gradientId}
              x1={ThreadFade.start}
              y1={ThreadFade.start}
              x2={ThreadFade.start}
              y2={ThreadFade.end}
            >
              <Stop
                offset={ThreadFade.start}
                stopColor={Color.black}
                stopOpacity={ThreadFade.opaque}
              />
              <Stop
                offset={ThreadFade.end}
                stopColor={Color.black}
                stopOpacity={ThreadFade.clear}
              />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fitted: { flexGrow: 0, flexShrink: 1 },
  topFade: { position: 'absolute', top: 0, left: 0 },
  content: {
    gap: Space.lg,
    paddingVertical: Space.xs,
  },
  entry: { gap: Space.xs },
  title: { ...Type.headline, color: Color.text },
  pastTitle: { color: Color.muted },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rule: { flex: 1, height: HAIRLINE, backgroundColor: Color.line },
  question: {
    ...Type.callout,
    color: Color.secondaryText,
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: Color.raised,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  liveQuestion: { color: Color.text },
  provisional: {
    color: Color.muted,
    backgroundColor: 'transparent',
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    borderStyle: 'dashed',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: Type.body.lineHeight,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: Color.muted,
  },
});

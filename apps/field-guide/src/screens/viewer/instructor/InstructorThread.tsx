import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import {
  EntryKind,
  ExchangePhase,
  type Exchange,
  type ThreadEntry,
} from '../viewerState';
import { CautionNote } from './CautionNote';
import { InstructorAnswer } from './InstructorAnswer';
import { FADE_IN, KaraokeText } from './InstructorMotion';
import {
  assistantBlocks,
  isRepeatedText,
  shownWordsFor,
} from '../assistant/repeatedContent';
import { parseAnswer } from '../../../features/instructor/answerFormat';

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

function Bubble({
  children,
  question = false,
  reducedMotion,
}: {
  children: ReactNode;
  question?: boolean;
  reducedMotion: boolean;
}) {
  return (
    <Animated.View
      testID="thread-bubble"
      entering={reducedMotion ? undefined : FADE_IN}
      style={question ? styles.questionBubble : styles.replyBubble}
    >
      {children}
    </Animated.View>
  );
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

function Thinking({
  still,
  assistant = false,
}: {
  still: boolean;
  assistant?: boolean;
}) {
  return (
    <Animated.View
      testID="instructor-thinking"
      accessible
      accessibilityLabel="Thinking"
      entering={assistant && still ? undefined : FADE_IN}
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
  variant?: 'panel' | 'assistant';
  shownText?: readonly string[];
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
  variant = 'panel',
  shownText,
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
        variant={variant}
        shownText={shownText}
      />
    );
  return (
    <>
      {answer}
      {caution !== '' &&
        !(
          variant === 'assistant' && isRepeatedText(caution, shownText ?? [])
        ) &&
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

interface ReplyProps {
  exchange: Exchange;
  live: boolean;
  index: number;
  voice: InstructorVoice;
  reducedMotion: boolean;
  variant?: 'panel' | 'assistant';
  shownText?: readonly string[];
}

function Reply({
  exchange,
  live,
  index,
  voice,
  reducedMotion,
  variant,
  shownText,
}: ReplyProps) {
  if (exchange.reply === '' && live && !exchange.interrupted) {
    return (
      <Thinking still={reducedMotion} assistant={variant === 'assistant'} />
    );
  }
  return (
    <Said
      reply={exchange.reply}
      caution={exchange.caution}
      live={live}
      index={index}
      voice={voice}
      streaming={exchange.phase === ExchangePhase.streaming}
      reducedMotion={reducedMotion}
      interrupted={exchange.interrupted}
      variant={variant}
      shownText={shownText}
    />
  );
}

function AssistantEntry({
  exchange,
  index,
  live,
  voice,
  reducedMotion,
  shownText = [],
}: ReplyProps) {
  const streaming = exchange.phase === ExchangePhase.streaming;
  const hasReply = useMemo(
    () =>
      assistantBlocks(
        parseAnswer(exchange.reply, streaming).blocks,
        shownText,
        streaming,
      ).length > 0,
    [exchange.reply, shownText, streaming],
  );
  const hasCaution =
    exchange.caution !== '' && !isRepeatedText(exchange.caution, shownText);
  const thinking = live && exchange.reply === '' && !exchange.interrupted;
  return (
    <View testID={`thread-entry-${index}`} style={styles.entry}>
      {exchange.question !== '' && (
        <Bubble question reducedMotion={reducedMotion}>
          <Text
            testID={live ? 'instructor-question' : `thread-question-${index}`}
            style={styles.assistantQuestion}
          >
            {exchange.question}
          </Text>
        </Bubble>
      )}
      {!exchange.readsStep &&
        (hasReply || hasCaution || thinking || exchange.interrupted) && (
          <Bubble reducedMotion={reducedMotion}>
            <Reply
              exchange={exchange}
              live={live}
              index={index}
              voice={voice}
              reducedMotion={reducedMotion}
              variant="assistant"
              shownText={shownText}
            />
          </Bubble>
        )}
    </View>
  );
}

interface Props {
  thread: readonly ThreadEntry[];
  exchange: Exchange | null;
  transcript: string;
  voice: InstructorVoice;
  reducedMotion: boolean;
  variant?: 'panel' | 'assistant';
  /** Text the drawer and part card already show, which assistant bubbles leave out. */
  alreadyShown?: readonly string[];
}

export function InstructorThread({
  thread,
  exchange,
  transcript,
  voice,
  reducedMotion,
  variant = 'panel',
  alreadyShown = [],
}: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const [scrolled, setScrolled] = useState(false);
  const wasScrolled = useRef(false);
  const gradientId = useId();
  const following = useRef(true);
  const readerMomentum = useRef(false);
  const assistant = variant === 'assistant';
  const entries: readonly ThreadEntry[] =
    exchange === null
      ? thread
      : [...thread, { kind: EntryKind.exchange, exchange }];
  const live = entries.length - 1;
  const shown = assistant
    ? entries.filter(entry => entry.kind === EntryKind.exchange)
    : entries;
  const shownText = useMemo(
    () =>
      assistant
        ? shownWordsFor([
            ...alreadyShown,
            ...thread.flatMap(entry =>
              entry.kind === EntryKind.step
                ? [entry.card.title, entry.card.body, entry.card.caution]
                : [],
            ),
          ])
        : [],
    [assistant, alreadyShown, thread],
  );
  const follow = ({
    nativeEvent: { contentOffset, contentSize, layoutMeasurement },
  }: NativeSyntheticEvent<NativeScrollEvent>) => {
    following.current =
      contentOffset.y + layoutMeasurement.height >=
      contentSize.height - FOLLOW_SLOP;
  };
  const followMomentumEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (readerMomentum.current) {
      readerMomentum.current = false;
      follow(event);
    }
  };
  // Bring a new entry into view even when the reader has scrolled back.
  const said = `${entries.length}:${transcript === ''}`;
  const seen = useRef(said);

  if (shown.length === 0 && transcript === '') {
    return null;
  }

  return (
    <View style={[styles.fitted, assistant && styles.assistantFitted]}>
      <ScrollView
        ref={scroll}
        testID="instructor-thread"
        style={[styles.fitted, assistant && styles.assistantFitted]}
        contentContainerStyle={[
          styles.content,
          assistant && styles.assistantContent,
        ]}
        keyboardShouldPersistTaps={assistant ? 'handled' : undefined}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent: { contentOffset } }) => {
          const nextScrolled = contentOffset.y > 0;
          if (nextScrolled !== wasScrolled.current) {
            wasScrolled.current = nextScrolled;
            setScrolled(nextScrolled);
          }
        }}
        // Only the reader's own drag decides whether to follow. Programmatic scrolls
        // also end with a momentum end, and a streamed reply can outgrow them.
        onScrollBeginDrag={() => {
          readerMomentum.current = false;
        }}
        onScrollEndDrag={follow}
        onMomentumScrollBegin={() => {
          readerMomentum.current = true;
        }}
        onMomentumScrollEnd={followMomentumEnd}
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
          !shown.includes(entry) ? null : assistant &&
            entry.kind === EntryKind.exchange ? (
            <AssistantEntry
              key={entryKey(entry)}
              exchange={entry.exchange}
              live={index === live}
              index={index}
              voice={voice}
              reducedMotion={reducedMotion}
              shownText={shownText}
            />
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
                  <Reply
                    exchange={entry.exchange}
                    live={index === live}
                    index={index}
                    voice={voice}
                    reducedMotion={reducedMotion}
                  />
                </>
              )}
            </Animated.View>
          ),
        )}
        {transcript !== '' &&
          (assistant ? (
            <Bubble question reducedMotion={reducedMotion}>
              <Text
                testID="instructor-transcript"
                accessibilityLabel={`Provisional transcript: ${transcript}`}
                style={styles.assistantQuestion}
              >
                {transcript}
              </Text>
            </Bubble>
          ) : (
            <Text
              testID="instructor-transcript"
              accessibilityLabel={`Provisional transcript: ${transcript}`}
              style={[styles.question, styles.provisional]}
            >
              {transcript}
            </Text>
          ))}
      </ScrollView>
      {scrolled && !assistant && (
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
  assistantFitted: { minHeight: 0 },
  assistantContent: { gap: Space.md },
  questionBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.control,
    backgroundColor: Color.field,
  },
  replyBubble: { gap: Space.sm },
  assistantQuestion: { ...Type.callout, color: Color.text },
  topFade: { position: 'absolute', top: 0, left: 0 },
  content: {
    gap: Space.lg,
    paddingVertical: Space.xs,
  },
  entry: { gap: Space.xs },
  title: { ...Type.headline, color: Color.text },
  pastTitle: { color: Color.muted },
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

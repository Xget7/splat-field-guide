import { useCallback, useRef, useState } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedRef,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Button,
  IconButton,
  IconButtonVariant,
} from '../../../shared/ui/kit/Button';
import { IconName } from '../../../shared/ui/kit/Icon';
import { stepLabel } from '../../../shared/ui/readout';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../shared/ui/theme';
import { CautionNote } from './CautionNote';
import type { CardContent } from '../model/guideContent';
import { StepSegments } from './StepSegments';
import { SpokenSection } from '../../../modules/instructor/voice/model/speechPresentation';
import {
  FADE_IN,
  FADE_OUT,
  PANEL_LAYOUT,
  InstructorScan,
  InstructorStatus,
  InstructorTalk,
  KaraokeText,
} from './InstructorMotion';
import {
  PanelMode,
  PanelPan,
  panelAfterDrag,
  panelOffset,
  togglePanel,
} from '../model/panelMotion';
import {
  VoiceState,
  type InstructorVoice,
} from '../../../modules/instructor/voice/hooks/useInstructorVoice';

// The splat keeps most of the screen even for a long answer.
const MAX_PANEL_SHARE = '55%';
const TALK_SIZE = 56;
const SIDE_SIZE = MIN_TOUCH;
// The answer being replaced stays readable but plainly not current.
const STALE_OPACITY = 0.45;
const InputMode = { voice: 'voice', keyboard: 'keyboard' } as const;
type InputMode = (typeof InputMode)[keyof typeof InputMode];
const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 4;
const GRABBER_SLOP = (MIN_TOUCH - Space.lg) / 2;
const STEP_EXCHANGE_KEY = 'step';

// Hands free there is no button to discover, so the panel says what can be said. Quoted
// words are the commands the router knows; they read brighter than the rest.
const HandsFreeCue = {
  step: [
    'Say ',
    '"next"',
    ', ',
    '"repeat"',
    ' or ',
    '"back"',
    ', or ask a question.',
  ],
  part: ['Ask about a part, or say ', '"show me"', ' and its name.'],
  busy: ['Talk over me to interrupt.'],
  muted: ['Muted. Tap the mic to listen again.'],
} as const;
const COMMAND_QUOTE = '"';

function handsFreeCue(voice: InstructorVoice, hasStep: boolean) {
  if (!voice.handsFree) {
    return null;
  }
  if (voice.muted) {
    return HandsFreeCue.muted;
  }
  if (
    voice.state === VoiceState.speaking ||
    voice.state === VoiceState.thinking
  ) {
    return HandsFreeCue.busy;
  }
  return hasStep ? HandsFreeCue.step : HandsFreeCue.part;
}

/** What the panel shows: the last question, if any, and the answer to it. */
export interface InstructorMessage {
  readonly id: number | null;
  readonly question: string | null;
  readonly reply: string;
  readonly caution: string;
}

interface Props {
  message: InstructorMessage;
  content: CardContent;
  bottomInset: number;
  onAsk: (question: string) => void;
  voice: InstructorVoice;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  onBack: () => void;
  onNext: () => void;
}

/** Answers grounded in the pack, with the current subject in view. */
export function InstructorPanel({
  message,
  content,
  bottomInset,
  onAsk,
  voice,
  mode,
  onModeChange,
  onBack,
  onNext,
}: Props) {
  const [draft, setDraft] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>(InputMode.voice);
  const listening = voice.state === VoiceState.listening;
  // The last question stays until the transcript has words to replace it.
  const question = listening
    ? voice.transcript || message.question
    : message.question;
  const transcribing = listening && voice.transcript !== '';
  // A question in flight has no words back yet; until it does, the last answer stays
  // where it was, dimmed, so nothing below the question jumps or blanks out.
  const awaiting = message.question !== null && message.reply === '';
  const [lastAnswer, setLastAnswer] = useState(message);
  if (!awaiting && lastAnswer !== message) {
    setLastAnswer(message);
  }
  const answer = awaiting ? lastAnswer : message;
  const stale = listening || awaiting;
  // From the press until the new answer has words the panel keeps its height: a growing
  // transcript or a hint that clears must not resize the splat above it mid-sentence.
  const [holding, setHolding] = useState(false);
  const [heldHeight, setHeldHeight] = useState(0);
  const measuredHeight = useRef(0);
  const heightLocked = (holding || listening || awaiting) && heldHeight > 0;
  const holdHeight = useCallback(() => {
    setHeldHeight(measuredHeight.current);
  }, []);
  const onHoldChange = useCallback(
    (next: boolean) => {
      if (next) {
        holdHeight();
      }
      setHolding(next);
    },
    [holdHeight],
  );
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const reducedMotion = useReducedMotion();
  const minimized = mode === PanelMode.minimized;
  const hasStep = content.stepCount > 0;
  const step = hasStep
    ? stepLabel(content.stepNumber, content.stepCount)
    : null;
  const drag = useSharedValue(0);
  const travel = useSharedValue<number>(PanelPan.defaultTravel);
  const layout = reducedMotion ? undefined : PANEL_LAYOUT;
  const panelStyle = useAnimatedStyle(() =>
    reducedMotion ? {} : { transform: [{ translateY: drag.value }] },
  );
  const changeMode = useCallback(
    (next: PanelMode) => {
      if (next === PanelMode.minimized) {
        Keyboard.dismiss();
        setInputMode(InputMode.voice);
      }
      onModeChange(next);
    },
    [onModeChange],
  );
  const toggle = () => changeMode(togglePanel(mode));
  const toggleLabel = minimized ? 'Expand instructor' : 'Minimize instructor';
  const pan = usePanGesture({
    maxPointers: 1,
    activeOffsetY: [-PanelPan.activation, PanelPan.activation],
    failOffsetX: [-PanelPan.horizontalTolerance, PanelPan.horizontalTolerance],
    onActivate: () => {
      'worklet';
      cancelAnimation(drag);
    },
    onUpdate: event => {
      'worklet';
      drag.value = reducedMotion
        ? 0
        : panelOffset(mode, event.translationY, travel.value);
    },
    onDeactivate: event => {
      'worklet';
      const next = panelAfterDrag(
        mode,
        event.translationY,
        event.velocityY,
        event.canceled,
      );
      drag.value = reducedMotion ? 0 : withSpring(0, Motion.spring);
      if (next !== mode) {
        scheduleOnRN(changeMode, next);
      }
    },
    onFinalize: event => {
      'worklet';
      if (event.canceled) {
        drag.value = reducedMotion ? 0 : withSpring(0, Motion.spring);
      }
    },
  });
  const speakingReply =
    voice.state === VoiceState.speaking &&
    voice.section === SpokenSection.reply;
  const speakingCaution =
    voice.state === VoiceState.speaking &&
    voice.section === SpokenSection.caution;
  const preview = voice.hint || (listening ? question ?? '' : message.reply);
  const canStop =
    voice.state === VoiceState.speaking || voice.state === VoiceState.thinking;
  const cue = voice.hint === '' ? handsFreeCue(voice, hasStep) : null;
  const send = useCallback(() => {
    if (draft.trim() === '') {
      return;
    }
    holdHeight();
    onAsk(draft);
    setDraft('');
    // Down goes the keyboard so the part it shows is in view.
    Keyboard.dismiss();
  }, [draft, onAsk, holdHeight]);
  const previous = hasStep ? (
    <IconButton
      testID="instructor-back"
      icon={IconName.back}
      accessibilityLabel="Previous step"
      size={SIDE_SIZE}
      disabled={content.backDisabled}
      style={styles.sideControl}
      onPress={onBack}
    />
  ) : null;
  const next = hasStep ? (
    <Button
      testID="instructor-next"
      label={content.last ? 'Finish' : 'Next'}
      icon={content.last ? IconName.check : IconName.next}
      accessibilityLabel={content.last ? 'Finish procedure' : 'Next step'}
      disabled={content.nextDisabled}
      onPress={onNext}
      style={styles.next}
    />
  ) : null;

  return (
    <Animated.View
      testID="instructor-panel"
      layout={layout}
      onLayout={event => {
        measuredHeight.current = event.nativeEvent.layout.height;
        if (!minimized) {
          travel.value = Math.max(
            PanelPan.distance,
            event.nativeEvent.layout.height - SIDE_SIZE,
          );
        }
      }}
      style={[
        styles.panel,
        minimized && styles.minimized,
        heightLocked && { height: heldHeight, maxHeight: heldHeight },
        { paddingBottom: bottomInset + Space.md },
        panelStyle,
      ]}
    >
      <InstructorScan
        active={voice.state === VoiceState.thinking}
        reducedMotion={reducedMotion}
      />
      <GestureDetector gesture={pan}>
        <View collapsable={false} testID="instructor-handle">
          <Pressable
            testID="instructor-grabber"
            accessibilityRole="button"
            accessibilityLabel={toggleLabel}
            accessibilityState={{ expanded: !minimized }}
            onPress={toggle}
            hitSlop={GRABBER_SLOP}
            style={styles.grabberArea}
          >
            <View style={styles.grabber} />
          </Pressable>
          <View style={styles.headerRow}>
            <Pressable
              testID="instructor-header"
              accessibilityRole="button"
              accessibilityLabel={toggleLabel}
              accessibilityState={{ expanded: !minimized }}
              onPress={toggle}
              style={styles.headerButton}
            >
              <View style={styles.header}>
                <Text style={styles.label}>Instructor</Text>
                <InstructorStatus voice={voice} step={step} />
              </View>
              {minimized && preview !== '' && (
                <Animated.View
                  key={voice.hint || (message.id ?? STEP_EXCHANGE_KEY)}
                  entering={FADE_IN}
                  exiting={FADE_OUT}
                >
                  <KaraokeText
                    id="instructor-preview"
                    text={preview}
                    speaking={speakingReply && voice.hint === ''}
                    word={voice.word}
                    style={Type.footnote}
                    numberOfLines={1}
                  />
                </Animated.View>
              )}
            </Pressable>
            {!minimized && voice.canListen && (
              <IconButton
                testID="instructor-hands-free"
                icon={IconName.handsFree}
                accessibilityLabel="Hands-free"
                accessibilityHint="Listens all the time, so you can talk without holding the mic"
                accessibilityState={{ selected: voice.handsFree }}
                variant={
                  voice.handsFree
                    ? IconButtonVariant.active
                    : IconButtonVariant.raised
                }
                style={voice.handsFree ? undefined : styles.sideControl}
                onPress={voice.toggleHandsFree}
              />
            )}
            {!minimized && canStop && (
              <Animated.View entering={FADE_IN} exiting={FADE_OUT}>
                <IconButton
                  testID="instructor-stop"
                  icon={IconName.stop}
                  accessibilityLabel="Stop instructor"
                  style={styles.sideControl}
                  onPress={voice.stop}
                />
              </Animated.View>
            )}
            {minimized && (
              <InstructorTalk
                voice={voice}
                size={SIDE_SIZE}
                reducedMotion={reducedMotion}
                onHoldChange={onHoldChange}
              />
            )}
            {minimized && hasStep && (
              <IconButton
                testID="instructor-next"
                icon={content.last ? IconName.check : IconName.next}
                accessibilityLabel={
                  content.last ? 'Finish procedure' : 'Next step'
                }
                disabled={content.nextDisabled}
                variant={IconButtonVariant.active}
                onPress={onNext}
              />
            )}
          </View>
        </View>
      </GestureDetector>
      {!minimized && (
        <>
          {hasStep && (
            <StepSegments
              count={content.stepCount}
              current={content.stepNumber - 1}
            />
          )}
          <Animated.ScrollView
            ref={scroll}
            style={styles.scroll}
            layout={layout}
            onContentSizeChange={() => {
              // The transcript sits on top, so a long last answer must not push it away.
              if (transcribing) {
                scroll.current?.scrollTo({ y: 0, animated: false });
              }
            }}
          >
            <Animated.View
              key={answer.id ?? STEP_EXCHANGE_KEY}
              entering={FADE_IN}
              exiting={FADE_OUT}
              layout={layout}
              style={styles.text}
            >
              {question !== null && (
                <Text
                  testID="instructor-question"
                  accessibilityLabel={
                    transcribing
                      ? `Provisional transcript: ${question}`
                      : undefined
                  }
                  style={[styles.question, transcribing && styles.provisional]}
                >
                  {question}
                </Text>
              )}
              <View
                testID="instructor-answer"
                accessibilityState={{ busy: stale }}
                style={[styles.text, stale && styles.stale]}
              >
                {answer.reply !== '' && (
                  <KaraokeText
                    id="instructor-reply"
                    text={answer.reply}
                    speaking={speakingReply && !stale}
                    word={voice.word}
                  />
                )}
                {answer.caution !== '' && (
                  <CautionNote text={answer.caution}>
                    <KaraokeText
                      id="instructor-caution-text"
                      text={answer.caution}
                      speaking={speakingCaution && !stale}
                      word={voice.word}
                      style={Type.footnote}
                    />
                  </CautionNote>
                )}
              </View>
            </Animated.View>
          </Animated.ScrollView>
          {voice.hint !== '' && (
            <Animated.Text
              key={voice.hint}
              entering={FADE_IN}
              exiting={FADE_OUT}
              testID="instructor-hint"
              accessibilityLiveRegion="polite"
              style={styles.hint}
            >
              {voice.hint}
            </Animated.Text>
          )}
          {cue !== null && (
            <Animated.Text
              key={cue.join('')}
              entering={FADE_IN}
              exiting={FADE_OUT}
              testID="instructor-cue"
              accessibilityLabel={cue.join('')}
              accessibilityLiveRegion="polite"
              style={styles.hint}
            >
              {cue.map((part, index) =>
                part.startsWith(COMMAND_QUOTE) ? (
                  <Text key={index} style={styles.command}>
                    {part}
                  </Text>
                ) : (
                  part
                ),
              )}
            </Animated.Text>
          )}
          {inputMode === InputMode.keyboard ? (
            <>
              <View style={styles.inputRow}>
                <IconButton
                  testID="instructor-mic"
                  icon={IconName.mic}
                  accessibilityLabel="Use voice input"
                  style={styles.sideControl}
                  onPress={() => {
                    Keyboard.dismiss();
                    setInputMode(InputMode.voice);
                  }}
                />
                <TextInput
                  testID="instructor-input"
                  autoFocus
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
              {hasStep && (
                <View style={styles.talkRow}>
                  {previous}
                  {next}
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.talkRow}>
                {previous}
                <IconButton
                  testID="instructor-keyboard"
                  icon={IconName.keyboard}
                  size={SIDE_SIZE}
                  accessibilityLabel="Type a question"
                  style={styles.sideControl}
                  onPress={() => {
                    voice.interrupt();
                    setInputMode(InputMode.keyboard);
                  }}
                />
                <InstructorTalk
                  voice={voice}
                  size={TALK_SIZE}
                  reducedMotion={reducedMotion}
                  onHoldChange={onHoldChange}
                />
                {next}
              </View>
            </>
          )}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight: MAX_PANEL_SHARE,
    flexShrink: 1,
    paddingTop: Space.sm,
    paddingHorizontal: Space.lg,
    gap: Space.sm,
    backgroundColor: Color.black,
    borderTopWidth: HAIRLINE,
    borderTopColor: Color.line,
  },
  minimized: { maxHeight: undefined, gap: Space.xs },
  grabberArea: {
    height: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: GRABBER_WIDTH,
    height: GRABBER_HEIGHT,
    backgroundColor: Color.lineStrong,
    borderRadius: Radius.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  headerButton: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    gap: Space.xs,
  },
  label: { ...Type.label, color: Color.accent },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  text: { gap: Space.sm },
  question: {
    ...Type.callout,
    color: Color.secondaryText,
    alignSelf: 'flex-end',
    backgroundColor: Color.raised,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  provisional: {
    color: Color.muted,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    borderStyle: 'dashed',
  },
  stale: { opacity: STALE_OPACITY },
  hint: { ...Type.footnote, color: Color.muted },
  command: { color: Color.text },
  talkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
  next: { flex: 1, height: MIN_TOUCH, paddingHorizontal: Space.md },
  sideControl: { backgroundColor: 'transparent', borderWidth: 0 },
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

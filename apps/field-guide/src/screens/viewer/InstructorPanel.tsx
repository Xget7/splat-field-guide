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
  Icon,
  IconButton,
  IconButtonVariant,
  IconName,
} from '../../ui/kit';
import { stepLabel } from '../../ui/readout';
import {
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../ui/theme';
import { CautionNote } from './CautionNote';
import type { CardContent } from './guideContent';
import { StepSegments } from './StepSegments';
import type { Part, PartId } from '../../domain/pack';
import { SpokenSection } from '../../voice/speechPresentation';
import {
  FADE_IN,
  FADE_OUT,
  PANEL_LAYOUT,
  PART_ENTER,
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
} from './panelMotion';
import {
  VoiceState,
  type InstructorVoice,
} from '../../voice/useInstructorVoice';

// The splat keeps most of the screen even for a long answer.
const MAX_PANEL_SHARE = '55%';
const TALK_SIZE = 56;
const SIDE_SIZE = MIN_TOUCH;
const CHEVRON_SIZE = 16;
const InputMode = { voice: 'voice', keyboard: 'keyboard' } as const;
type InputMode = (typeof InputMode)[keyof typeof InputMode];
const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 4;
const GRABBER_SLOP = (MIN_TOUCH - Space.lg) / 2;
const STEP_EXCHANGE_KEY = 'step';

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
  part: Part | null;
  onFramePart: (id: PartId) => void;
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
  part,
  onFramePart,
  mode,
  onModeChange,
  onBack,
  onNext,
}: Props) {
  const [draft, setDraft] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>(InputMode.voice);
  const listening = voice.state === VoiceState.listening;
  const question = listening ? voice.transcript || null : message.question;
  // Once words arrive they take the answer's place, so the panel need not grow to show them.
  const transcribing = listening && voice.transcript !== '';
  // From the press until recognition lets go the panel keeps its height: a growing
  // transcript or a hint that clears must not resize the splat above it mid-sentence.
  const [holding, setHolding] = useState(false);
  const [heldHeight, setHeldHeight] = useState(0);
  const measuredHeight = useRef(0);
  const heightLocked = (holding || listening) && heldHeight > 0;
  const onHoldChange = useCallback((next: boolean) => {
    if (next) {
      setHeldHeight(measuredHeight.current);
    }
    setHolding(next);
  }, []);
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
  const send = useCallback(() => {
    if (draft.trim() === '') {
      return;
    }
    onAsk(draft);
    setDraft('');
    // Down goes the keyboard so the part it shows is in view.
    Keyboard.dismiss();
  }, [draft, onAsk]);
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
              if (transcribing) {
                scroll.current?.scrollToEnd({ animated: false });
              }
            }}
          >
            <Animated.View
              key={message.id ?? STEP_EXCHANGE_KEY}
              entering={FADE_IN}
              exiting={FADE_OUT}
              layout={layout}
              style={styles.text}
            >
              {question !== null && (
                <Text
                  testID="instructor-question"
                  accessibilityLabel={
                    listening
                      ? `Provisional transcript: ${question}`
                      : undefined
                  }
                  style={[styles.question, listening && styles.provisional]}
                >
                  {question}
                </Text>
              )}
              {!transcribing && message.reply !== '' && (
                <KaraokeText
                  id="instructor-reply"
                  text={message.reply}
                  speaking={speakingReply}
                  word={voice.word}
                />
              )}
              {!transcribing && message.caution !== '' && (
                <CautionNote text={message.caution}>
                  <KaraokeText
                    id="instructor-caution-text"
                    text={message.caution}
                    speaking={speakingCaution}
                    word={voice.word}
                    style={Type.footnote}
                  />
                </CautionNote>
              )}
              {!transcribing && part !== null && (
                <Animated.View
                  key={part.id}
                  entering={reducedMotion ? FADE_IN : PART_ENTER}
                  exiting={FADE_OUT}
                >
                  <Pressable
                    testID="instructor-part"
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${part.name} again`}
                    onPress={() => onFramePart(part.id)}
                    style={({ pressed }) => [
                      styles.part,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.partText}>{part.name}</Text>
                    <Icon
                      name={IconName.next}
                      size={CHEVRON_SIZE}
                      color={Color.accent}
                    />
                  </Pressable>
                </Animated.View>
              )}
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
  part: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Space.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    backgroundColor: Color.accentWash,
  },
  partText: { ...Type.footnote, color: Color.accent },
  hint: { ...Type.footnote, color: Color.muted },
  talkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
  next: { flex: 1, height: MIN_TOUCH, paddingHorizontal: Space.md },
  sideControl: { backgroundColor: 'transparent', borderWidth: 0 },
  pressed: { backgroundColor: Color.pressed },
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

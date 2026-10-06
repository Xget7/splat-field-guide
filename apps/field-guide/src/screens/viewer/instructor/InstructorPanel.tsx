import { useCallback, useState } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
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
import { Button, IconButton, IconButtonVariant } from '../../../ui/Button';
import { Icon, IconName } from '../../../ui/Icon';
import { stepLabel } from '../../../ui/readout';
import {
  BUTTON_HEIGHT,
  Color,
  HAIRLINE,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import type { CardContent } from '../guideContent';
import { EntryKind, type Exchange, type ThreadEntry } from '../viewerState';
import { InstructorThread } from './InstructorThread';
import {
  speechTextFor,
  SpokenSection,
} from '../../../features/instructor/voice/speechPresentation';
import {
  Composer,
  composerStyles,
  FADE_IN,
  FADE_OUT,
  PANEL_LAYOUT,
  InstructorScan,
  InstructorStatus,
  KaraokeText,
  MuteButton,
  VoiceBar,
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
} from '../../../features/instructor/voice/useInstructorVoice';

// Open under the splat, the panel is as tall as what it says, up to half the screen; past
// that the thread scrolls, so the splat above keeps the rest.
const CHAT_SHARE = '50%';
const DOCKED_SHARE = '60%';
const SIDE_SIZE = MIN_TOUCH;
const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 4;
const GRABBER_SLOP = (MIN_TOUCH - Space.lg) / 2;
const STEP_EXCHANGE_KEY = 'step';
const VOICE_ICON = 18;

// In voice mode there is no button to discover, so the panel says what can be said. Quoted
// words are the commands the router knows; they read brighter than the rest.
const VoiceCue = {
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

function voiceCue(voice: InstructorVoice, hasStep: boolean) {
  if (!voice.on) {
    return null;
  }
  if (voice.muted) {
    return VoiceCue.muted;
  }
  if (
    voice.state === VoiceState.speaking ||
    voice.state === VoiceState.thinking
  ) {
    return VoiceCue.busy;
  }
  return hasStep ? VoiceCue.step : VoiceCue.part;
}

interface Props {
  thread: readonly ThreadEntry[];
  exchange: Exchange | null;
  content: CardContent;
  bottomInset: number;
  onAsk: (question: string) => void;
  voice: InstructorVoice;
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  onBack: () => void;
  onNext: () => void;
  /** In a sidebar beside the splat: always open, with the steps listed above it. */
  docked?: boolean;
}

/** Answers grounded in the pack, with the current subject in view. */
export function InstructorPanel({
  thread,
  exchange,
  content,
  bottomInset,
  onAsk,
  voice,
  mode,
  onModeChange,
  onBack,
  onNext,
  docked = false,
}: Props) {
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const listening = voice.state === VoiceState.listening;
  const transcript = listening ? voice.transcript : '';
  // Without a live exchange, the last entry is the step on screen.
  const last = thread[thread.length - 1];
  const said =
    exchange ??
    (last === undefined
      ? null
      : last.kind === EntryKind.exchange
      ? last.exchange
      : { id: null, reply: last.card.body });
  const reducedMotion = useReducedMotion();
  const minimized = !docked && mode === PanelMode.minimized;
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
      }
      onModeChange(next);
    },
    [onModeChange],
  );
  // Open under the splat, the header says where in the procedure the thread below is.
  const heading = !minimized && !docked && step !== null ? step : 'Instructor';
  const toggle = () => changeMode(togglePanel(mode));
  const toggleLabel = minimized ? 'Expand instructor' : 'Minimize instructor';
  const pan = usePanGesture({
    enabled: !docked,
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
  const preview =
    voice.hint ||
    (listening
      ? transcript || exchange?.question || ''
      : speechTextFor(said?.reply ?? ''));
  const canStop =
    voice.state === VoiceState.speaking || voice.state === VoiceState.thinking;
  const cue = voice.hint === '' ? voiceCue(voice, hasStep) : null;
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
      size={BUTTON_HEIGHT}
      disabled={content.backDisabled}
      onPress={onBack}
    />
  ) : null;
  const next = hasStep ? (
    <Button
      testID="instructor-next"
      label={content.last ? 'Finish' : 'Next'}
      icon={content.last ? IconName.check : undefined}
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
        docked && styles.docked,
        { paddingBottom: bottomInset + Space.md },
        panelStyle,
      ]}
    >
      <InstructorScan
        // Open, the thread's dots already say it is thinking.
        active={minimized && voice.state === VoiceState.thinking}
        reducedMotion={reducedMotion}
      />
      <GestureDetector gesture={pan}>
        <View collapsable={false} testID="instructor-handle">
          {!docked && (
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
          )}
          <View style={styles.headerRow}>
            <Pressable
              testID="instructor-header"
              // Docked, the header only reads out: there is nothing to minimize.
              accessible={!docked}
              accessibilityRole={docked ? undefined : 'button'}
              accessibilityLabel={docked ? undefined : toggleLabel}
              accessibilityState={docked ? undefined : { expanded: !minimized }}
              disabled={docked}
              onPress={toggle}
              style={styles.headerButton}
            >
              <View style={styles.header}>
                <Text
                  testID={heading === step ? 'instructor-step' : undefined}
                  style={styles.label}
                >
                  {heading}
                </Text>
                <InstructorStatus
                  voice={voice}
                  // Open, the thread names each step itself.
                  step={minimized ? step : null}
                  live={voice.on && minimized}
                />
              </View>
              {minimized && preview !== '' && (
                <Animated.View
                  key={voice.hint || (said?.id ?? STEP_EXCHANGE_KEY)}
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
            {minimized && voice.on && <MuteButton voice={voice} />}
            {minimized && hasStep && (
              <IconButton
                testID="instructor-next"
                icon={content.last ? IconName.check : IconName.next}
                accessibilityLabel={
                  content.last ? 'Finish procedure' : 'Next step'
                }
                disabled={content.nextDisabled}
                variant={IconButtonVariant.primary}
                onPress={onNext}
              />
            )}
          </View>
        </View>
      </GestureDetector>
      {!minimized && (
        <>
          <InstructorThread
            thread={thread}
            exchange={exchange}
            transcript={transcript}
            voice={voice}
            reducedMotion={reducedMotion}
            compact={docked}
          />
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
          {voice.on ? (
            <VoiceBar voice={voice} />
          ) : (
            <View style={[composerStyles.frame, typing && composerStyles.open]}>
              <TextInput
                testID="instructor-input"
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
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                style={styles.input}
              />
              {draft.trim() === '' ? (
                // Named, not just drawn: a waveform alone was easy to miss.
                <Pressable
                  testID="instructor-voice"
                  accessibilityRole="button"
                  accessibilityLabel="Voice"
                  accessibilityHint="Reads everything aloud and listens, so you can talk instead of typing"
                  hitSlop={(MIN_TOUCH - Composer.button) / 2}
                  onPress={() => {
                    Keyboard.dismiss();
                    voice.toggle();
                  }}
                  style={({ pressed }) => [
                    composerStyles.quietButton,
                    styles.voiceButton,
                    pressed && styles.voicePressed,
                  ]}
                >
                  <Icon
                    name={IconName.handsFree}
                    size={VOICE_ICON}
                    color={Color.accent}
                  />
                  <Text style={styles.voiceLabel}>Voice</Text>
                </Pressable>
              ) : (
                <IconButton
                  testID="instructor-send"
                  icon={IconName.send}
                  accessibilityLabel="Send"
                  variant={IconButtonVariant.active}
                  size={Composer.button}
                  style={composerStyles.insetButton}
                  onPress={send}
                />
              )}
            </View>
          )}
          {hasStep && (
            <View style={styles.talkRow}>
              {previous}
              {next}
            </View>
          )}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight: CHAT_SHARE,
    paddingTop: Space.sm,
    paddingHorizontal: Space.lg,
    gap: Space.sm,
    backgroundColor: Color.black,
    borderTopWidth: HAIRLINE,
    borderTopColor: Color.line,
  },
  minimized: { gap: Space.xs },
  // No grabber above the header, so the top edge takes its own margin. Beside the splat
  // the panel grows with the conversation, and the steps above it give way.
  docked: {
    maxHeight: DOCKED_SHARE,
    flexShrink: 1,
    paddingTop: Space.md,
    gap: Space.md,
  },
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
  hint: { ...Type.footnote, color: Color.muted },
  command: { color: Color.text },
  talkRow: { flexDirection: 'row', gap: Space.sm },
  next: { flex: 1 },
  sideControl: { backgroundColor: 'transparent', borderWidth: 0 },
  voiceButton: {
    height: Composer.button,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
  },
  voicePressed: { backgroundColor: Color.lineStrong },
  voiceLabel: { ...Type.label, color: Color.text },
  input: {
    ...Type.callout,
    flex: 1,
    alignSelf: 'stretch',
    padding: 0,
    color: Color.text,
  },
});

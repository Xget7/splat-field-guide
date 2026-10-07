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
import {
  Button,
  ButtonVariant,
  IconButton,
  IconButtonVariant,
} from '../../../ui/Button';
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
import { ModeArea } from './ModeArea';
import { AppEvent } from '../../../features/events/types';
import { appEvents } from '../../../features/events/bus';
import { isSwitching } from '../../../features/events/mode';
import { toggleFor, useModeView } from './useModeView';
import {
  speechTextFor,
  SpokenSection,
} from '../../../features/instructor/voice/speechPresentation';
import {
  Composer,
  ContentFade,
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

// Cap the conversation height to keep the splat visible above it.
const CHAT_SHARE = '50%';
const SIDE_SIZE = MIN_TOUCH;
const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 4;
const GRABBER_SLOP = (MIN_TOUCH - Space.lg) / 2;
const VOICE_ICON = 18;

// Expose spoken commands because voice mode has no navigation buttons.
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
}

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
}: Props) {
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const listening = voice.state === VoiceState.listening;
  const transcript = listening ? voice.transcript : '';
  const last = thread[thread.length - 1];
  const said =
    exchange ??
    (last === undefined
      ? null
      : last.kind === EntryKind.exchange
      ? last.exchange
      : { id: null, reply: last.card.body });
  const reducedMotion = useReducedMotion();
  const instructorMode = useModeView();
  const switching = isSwitching(instructorMode.mode);
  const modeToggle = toggleFor(instructorMode);
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
      }
      onModeChange(next);
    },
    [onModeChange],
  );
  const heading = !minimized && step !== null ? step : 'Instructor';
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
    // Dismiss the keyboard so the selected part remains visible.
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
        { paddingBottom: bottomInset + Space.md },
        panelStyle,
      ]}
    >
      <InstructorScan
        // Avoid repeating the thinking indication already shown by the thread.
        active={minimized && voice.state === VoiceState.thinking}
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
                <Text
                  testID={heading === step ? 'instructor-step' : undefined}
                  style={styles.label}
                >
                  {heading}
                </Text>
                <InstructorStatus
                  voice={voice}
                  // Avoid repeating the step name already shown in the open thread.
                  step={minimized ? step : null}
                  live={voice.on && minimized}
                  minimized={minimized}
                />
              </View>
              <ContentFade contentKey={voice.hint || said?.id || null}>
                {minimized && preview !== '' ? (
                  <KaraokeText
                    id="instructor-preview"
                    text={preview}
                    speaking={speakingReply && voice.hint === ''}
                    word={voice.word}
                    style={Type.footnote}
                    numberOfLines={1}
                  />
                ) : null}
              </ContentFade>
            </Pressable>
            {!minimized && !switching && (
              <Button
                label={modeToggle.label}
                variant={ButtonVariant.quiet}
                accessibilityHint={modeToggle.hint}
                onPress={() =>
                  appEvents.emit(AppEvent.modeRequest, {
                    type: modeToggle.requestType,
                  })
                }
              />
            )}
            {!minimized && canStop && (
              <Animated.View entering={FADE_IN} exiting={FADE_OUT}>
                <IconButton
                  testID="instructor-stop"
                  icon={IconName.stop}
                  accessibilityLabel="Stop instructor"
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
          <ModeArea />
          <InstructorThread
            thread={thread}
            exchange={exchange}
            transcript={transcript}
            voice={voice}
            reducedMotion={reducedMotion}
          />
          <ContentFade contentKey={voice.hint || null}>
            {voice.hint !== '' ? (
              <Text
                testID="instructor-hint"
                accessibilityLiveRegion="polite"
                style={styles.hint}
              >
                {voice.hint}
              </Text>
            ) : null}
          </ContentFade>
          <ContentFade contentKey={cue?.join('') ?? null}>
            {cue !== null ? (
              <Text
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
              </Text>
            ) : null}
          </ContentFade>
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

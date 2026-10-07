import { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  VoiceState,
  type InstructorVoice,
} from '../../../features/instructor/voice/useInstructorVoice';
import { Glass, GlassTone } from '../../../ui/Glass';
import { Icon, IconName } from '../../../ui/Icon';
import {
  Color,
  MIN_TOUCH,
  Motion,
  Radius,
  Space,
  Type,
} from '../../../ui/theme';
import { EntryKind, type Exchange, type ThreadEntry } from '../viewerState';
import { LevelMeter, PANEL_LAYOUT } from '../instructor/InstructorMotion';
import { InstructorThread } from '../instructor/InstructorThread';
import { ModeArea } from '../instructor/ModeArea';
import { BOTTOM_BAND_HEIGHT } from '../shell/layout';
import { useDockKeyboard } from './useDockKeyboard';
import {
  useVoiceStatus,
  VoiceStatus,
  VoiceStatusLabel,
  VoiceTint,
  VoiceWave,
} from '../instructor/VoiceWave';

export const DOCK_COLLAPSED = {
  width: 320,
  height: BOTTOM_BAND_HEIGHT,
} as const;
export const DOCK_EXPANDED_WIDTH = 380;
export const DOCK_EXPANDED_HEIGHT = 640;
const DockSize = {
  collapsedHeight: DOCK_COLLAPSED.height,
  expandedHeight: DOCK_EXPANDED_HEIGHT,
  minimumExpandedHeight: 144,
} as const;
const Copy = {
  title: 'AI Assistant',
  empty: "Ask about any part or step, and I'll point to it on the model.",
  expandHint: 'Opens the conversation and controls for talking or typing',
  minimize: 'Minimize assistant',
  minimizeHint: 'Collapses the conversation and ends voice',
  placeholder: 'Ask about a part',
  input: 'Ask the instructor',
  inputHint: 'Type a question about the equipment',
  send: 'Send question',
  sendHint: 'Asks the instructor and clears the text field',
  start: 'Start voice',
  startHint: 'Reads aloud and listens continuously; talk to interrupt',
  mute: 'Mute the microphone',
  muteHint: 'Pauses listening while the instructor can keep speaking',
  unmute: 'Unmute the microphone',
  unmuteHint: 'Resumes listening; talk to interrupt',
  stop: 'Stop instructor',
  stopHint: 'Interrupts the current reply and cancels the pending question',
  end: 'End voice',
  endHint: 'Goes back to reading and typing',
  idle: 'Tap to talk',
} as const;

interface Props {
  thread: readonly ThreadEntry[];
  exchange: Exchange | null;
  /** Text the drawer and part card already show. */
  alreadyShown: readonly string[];
  onAsk: (question: string) => void;
  voice: InstructorVoice;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  bottomInset: number;
  maxHeight: number;
  collapsedWidth?: number;
  expandedWidth?: number;
}

export function AssistantDock({
  thread,
  exchange,
  alreadyShown,
  onAsk,
  voice,
  expanded,
  onExpandedChange,
  bottomInset,
  maxHeight,
  collapsedWidth = DOCK_COLLAPSED.width,
  expandedWidth = DOCK_EXPANDED_WIDTH,
}: Props) {
  const [draft, setDraft] = useState('');
  const reducedMotion = useReducedMotion();
  const { anchor, overlap, measure } = useDockKeyboard(Space.md);
  const availableHeight = maxHeight - overlap;
  const empty =
    exchange === null &&
    !thread.some(entry => entry.kind === EntryKind.exchange) &&
    voice.transcript === '';
  const busy =
    voice.state === VoiceState.thinking || voice.state === VoiceState.speaking;
  const voiceStatus = useVoiceStatus(voice);
  // Typed questions show Thinking too; idle, the mic in the composer speaks for itself.
  const status =
    voiceStatus ??
    (voice.state === VoiceState.thinking ? VoiceStatus.thinking : null);
  const metering =
    voiceStatus === VoiceStatus.speaking ||
    voiceStatus === VoiceStatus.listening;
  // Open, the dock keeps one tall height, so the conversation has room before it scrolls.
  const expandedHeight = Math.min(
    maxHeight,
    Math.max(
      DockSize.minimumExpandedHeight,
      Math.min(DockSize.expandedHeight, availableHeight),
    ),
  );
  const lift = useSharedValue(0);
  useEffect(() => {
    if (voice.on && !expanded) {
      onExpandedChange(true);
    }
  }, [voice.on, expanded, onExpandedChange]);
  useEffect(() => {
    lift.value = reducedMotion
      ? overlap
      : withTiming(overlap, { duration: Motion.base });
    return () => cancelAnimation(lift);
  }, [overlap, reducedMotion, lift]);
  const position = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value }],
  }));
  const send = useCallback(() => {
    const question = draft.trim();
    if (question === '') {
      return;
    }
    onAsk(question);
    setDraft('');
    Keyboard.dismiss();
  }, [draft, onAsk]);
  const mic = () => {
    Keyboard.dismiss();
    onExpandedChange(true);
    if (voice.on) {
      voice.toggleMuted();
    } else {
      voice.toggle();
    }
  };
  const minimize = () => {
    Keyboard.dismiss();
    voice.stop();
    // Expanded maps to the runtime's enabled state, so minimize ends voice too.
    if (voice.on) {
      voice.toggle();
    }
    onExpandedChange(false);
  };
  const micControl = (
    <Pressable
      testID="assistant-mic"
      accessibilityRole="button"
      accessibilityLabel={
        voice.on ? (voice.muted ? Copy.unmute : Copy.mute) : Copy.start
      }
      accessibilityHint={
        voice.on
          ? voice.muted
            ? Copy.unmuteHint
            : Copy.muteHint
          : Copy.startHint
      }
      accessibilityState={{ selected: voice.open && !voice.muted }}
      onPress={mic}
      style={({ pressed }) => [
        styles.roundButton,
        voice.open && !voice.muted && styles.filled,
        pressed && styles.pressed,
        pressed && voice.open && !voice.muted && styles.filledPressed,
      ]}
    >
      <Icon
        name={voice.muted ? IconName.micOff : IconName.mic}
        color={voice.open && !voice.muted ? Color.accentText : Color.text}
      />
    </Pressable>
  );

  return (
    <View
      ref={anchor}
      collapsable={false}
      testID="assistant-anchor"
      onLayout={measure}
      style={[styles.anchor, { marginBottom: bottomInset }]}
    >
      <Animated.View
        testID="assistant-dock"
        layout={reducedMotion ? undefined : PANEL_LAYOUT}
        style={[
          expanded
            ? { width: expandedWidth, height: expandedHeight }
            : { width: collapsedWidth },
          position,
        ]}
      >
        {/* One frosted panel that grows up from the collapsed card. */}
        <Glass
          tone={GlassTone.strong}
          radius={Radius.card}
          style={expanded ? styles.panel : styles.collapsed}
        >
          {expanded ? (
            <>
              <VoiceTint listening={voiceStatus === VoiceStatus.listening} />
              <View style={styles.header}>
                <View style={styles.heading}>
                  <Text accessibilityRole="header" style={styles.title}>
                    {Copy.title}
                  </Text>
                  {status !== null && (
                    <VoiceStatusLabel status={status} id="assistant-status" />
                  )}
                </View>
                {busy && (
                  <Pressable
                    testID="assistant-stop"
                    accessibilityRole="button"
                    accessibilityLabel={Copy.stop}
                    accessibilityHint={Copy.stopHint}
                    accessibilityState={{ disabled: false }}
                    onPress={voice.stop}
                    style={({ pressed }) => [
                      styles.roundButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Icon name={IconName.stop} />
                  </Pressable>
                )}
                <Pressable
                  testID="assistant-minimize"
                  accessibilityRole="button"
                  accessibilityLabel={Copy.minimize}
                  accessibilityHint={Copy.minimizeHint}
                  accessibilityState={{ expanded: true }}
                  onPress={minimize}
                  style={({ pressed }) => [
                    styles.roundButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon name={IconName.down} />
                </Pressable>
              </View>
              <View style={styles.conversation}>
                <ModeArea />
                {empty && <Text style={styles.empty}>{Copy.empty}</Text>}
                <InstructorThread
                  thread={thread}
                  exchange={exchange}
                  alreadyShown={alreadyShown}
                  transcript={
                    voice.state === VoiceState.listening ? voice.transcript : ''
                  }
                  reducedMotion={reducedMotion}
                  variant="assistant"
                />
                {voice.hint !== '' && (
                  <Text accessibilityLiveRegion="polite" style={styles.status}>
                    {voice.hint}
                  </Text>
                )}
              </View>
              {voiceStatus !== null ? (
                <View style={styles.composer}>
                  <Pressable
                    testID="assistant-end-voice"
                    accessibilityRole="button"
                    accessibilityLabel={Copy.end}
                    accessibilityHint={Copy.endHint}
                    onPress={voice.toggle}
                    style={({ pressed }) => [
                      styles.roundButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Icon name={IconName.close} />
                  </Pressable>
                  <VoiceWave voice={voice} status={voiceStatus} />
                  {micControl}
                </View>
              ) : (
                <View style={styles.composer}>
                  <TextInput
                    testID="assistant-input"
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={send}
                    placeholder={Copy.placeholder}
                    placeholderTextColor={Color.muted}
                    accessibilityLabel={Copy.input}
                    accessibilityHint={Copy.inputHint}
                    accessibilityState={{ disabled: false }}
                    returnKeyType="send"
                    enablesReturnKeyAutomatically
                    autoCorrect={false}
                    keyboardAppearance="dark"
                    selectionColor={Color.accent}
                    style={styles.input}
                  />
                  {/* Like a chat app, the mic gives way to Send once there is text. */}
                  {draft.trim() === '' ? (
                    micControl
                  ) : (
                    <Pressable
                      testID="assistant-send"
                      accessibilityRole="button"
                      accessibilityLabel={Copy.send}
                      accessibilityHint={Copy.sendHint}
                      onPress={send}
                      style={({ pressed }) => [
                        styles.roundButton,
                        styles.filled,
                        pressed && styles.filledPressed,
                      ]}
                    >
                      <Icon name={IconName.send} color={Color.accentText} />
                    </Pressable>
                  )}
                </View>
              )}
            </>
          ) : (
            <>
              <Pressable
                testID="assistant-expand"
                accessibilityRole="button"
                accessibilityLabel={Copy.title}
                accessibilityHint={Copy.expandHint}
                accessibilityState={{ expanded: false }}
                accessibilityValue={{ text: status ?? Copy.idle }}
                onPress={() => onExpandedChange(true)}
                style={styles.expandButton}
              >
                <Text style={styles.title}>{Copy.title}</Text>
                <View style={styles.statusRow}>
                  {status === null ? (
                    <Text testID="assistant-status" style={styles.status}>
                      {Copy.idle}
                    </Text>
                  ) : (
                    <VoiceStatusLabel status={status} id="assistant-status" />
                  )}
                  {metering && <LevelMeter level={voice.level} />}
                </View>
              </Pressable>
              {micControl}
            </>
          )}
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { alignSelf: 'flex-end' },
  panel: { flex: 1 },
  collapsed: {
    height: DockSize.collapsedHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Space.lg,
    paddingRight: Space.sm + Space.xs,
    gap: Space.md,
  },
  expandButton: {
    flex: 1,
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    gap: Space.xxs,
  },
  header: {
    minHeight: DockSize.collapsedHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Space.lg,
    paddingRight: Space.sm + Space.xs,
    gap: Space.xs,
  },
  heading: { flex: 1, gap: Space.xxs },
  title: { ...Type.calloutStrong, color: Color.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  status: { ...Type.footnote, color: Color.muted },
  roundButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { backgroundColor: Color.accentFill },
  pressed: { backgroundColor: Color.field },
  filledPressed: { backgroundColor: Color.accentPressed },
  // Like a chat, the conversation sits on the composer and grows upward.
  conversation: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'flex-end',
    paddingHorizontal: Space.lg,
    gap: Space.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Space.sm,
    gap: Space.xs,
  },
  input: {
    ...Type.callout,
    color: Color.text,
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingVertical: 0,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.control,
    backgroundColor: Color.field,
  },
  empty: { ...Type.callout, color: Color.secondaryText },
});

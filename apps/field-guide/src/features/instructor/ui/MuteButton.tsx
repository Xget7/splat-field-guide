import { StyleSheet } from 'react-native';
import { IconButton, IconButtonVariant } from '../../../ui/Button';
import { IconName } from '../../../ui/Icon';
import { Color, HAIRLINE } from '../../../ui/theme';
import { Composer, composerStyles } from './Composer';
import type { InstructorVoice } from './useInstructorVoice';

export function MuteButton({
  voice,
  inset = false,
}: {
  voice: InstructorVoice;
  /** The composer already provides the outline when this control is inset. */
  inset?: boolean;
}) {
  return (
    <IconButton
      testID="instructor-mute"
      icon={voice.muted ? IconName.micOff : IconName.mic}
      variant={
        voice.muted ? IconButtonVariant.raised : IconButtonVariant.active
      }
      accessibilityLabel={
        voice.muted ? 'Unmute the microphone' : 'Mute the microphone'
      }
      accessibilityState={{ selected: !voice.muted }}
      size={inset ? Composer.button : undefined}
      onPress={voice.toggleMuted}
      style={
        inset
          ? voice.muted
            ? composerStyles.quietButton
            : composerStyles.insetButton
          : voice.muted
          ? styles.muted
          : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  muted: { borderWidth: HAIRLINE, borderColor: Color.caution },
});

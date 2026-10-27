import { StyleSheet, View } from 'react-native';
import { IconButton } from '../../../ui/Button';
import { IconName } from '../../../ui/Icon';
import { Space } from '../../../ui/theme';
import type { VoiceStatus } from './AssistantStatus';
import { Composer, composerStyles } from './Composer';
import { MuteButton } from './MuteButton';
import type { InstructorVoice } from './useInstructorVoice';
import { VoiceWave } from './VoiceWave';

export function VoiceBar({
  voice,
  status,
}: {
  voice: InstructorVoice;
  status: VoiceStatus;
}) {
  return (
    <View style={styles.voiceRow}>
      <IconButton
        testID="instructor-voice-end"
        icon={IconName.close}
        accessibilityLabel="End voice"
        accessibilityHint="Goes back to reading and typing"
        size={Composer.button}
        style={composerStyles.quietButton}
        onPress={voice.toggle}
      />
      <VoiceWave voice={voice} status={status} />
      <MuteButton voice={voice} inset />
    </View>
  );
}

const styles = StyleSheet.create({
  voiceRow: {
    height: Composer.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
});

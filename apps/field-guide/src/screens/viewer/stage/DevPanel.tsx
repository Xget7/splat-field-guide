import { StyleSheet, Text, View } from 'react-native';
import {
  useAgentStatus,
  useInstructorMode,
  useNetwork,
} from '../../../features/events/useAppEvent';
import {
  AgentFailure,
  AgentState,
  AnswerSource,
  InstructorMode,
  NetworkQuality,
  Transport,
  VoiceSource,
} from '../../../features/events/types';
import { ConnectionWord } from '../../../features/instructor/mode/modeCopy';
import type { Pack } from '../../../features/pack/pack';
import { Color, Space, Type } from '../../../ui/theme';

const MS_PER_SECOND = 1000;
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;
const DevCopy = {
  title: 'Dev',
  assistant: 'Assistant',
  network: 'Network',
  cloud: 'Cloud',
  mode: 'Mode',
  voice: 'Voice',
  answers: 'Answers',
  agent: 'Agent',
  quality: 'Quality',
  link: 'Link',
  reason: 'Reason',
  splats: 'Splats',
  pack: 'Pack',
  loaded: 'First frame',
  loading: 'Loading',
} as const;
const ModeText: Record<InstructorMode, string> = {
  [InstructorMode.online]: ConnectionWord.online,
  [InstructorMode.switchingToOffline]: 'Switching to offline',
  [InstructorMode.offline]: ConnectionWord.offline,
  [InstructorMode.switchingToOnline]: 'Switching to online',
};
const VoiceText: Record<VoiceSource, string> = {
  [VoiceSource.agent]: 'ElevenLabs agent',
  [VoiceSource.device]: 'On-device speech',
};
const AnswerText: Record<AnswerSource, string> = {
  [AnswerSource.claude]: 'Claude',
  [AnswerSource.deviceModel]: 'On-device model',
  [AnswerSource.script]: 'Scripted replies',
};
const AgentText: Record<AgentState, string> = {
  [AgentState.idle]: 'Idle',
  [AgentState.connecting]: ConnectionWord.connecting,
  [AgentState.connected]: 'Connected',
  [AgentState.ended]: 'Ended',
  [AgentState.failed]: 'Failed',
};
const FailureText: Record<AgentFailure, string> = {
  [AgentFailure.quota]: 'quota reached',
  [AgentFailure.auth]: 'not authorized',
  [AgentFailure.network]: 'network error',
  [AgentFailure.unknown]: 'unknown error',
};
const QualityText: Record<NetworkQuality, string> = {
  [NetworkQuality.good]: 'Good',
  [NetworkQuality.weak]: 'Weak',
  [NetworkQuality.offline]: ConnectionWord.offline,
};
const TransportText: Record<Transport, string> = {
  [Transport.wifi]: 'Wi-Fi',
  [Transport.cellular]: 'Cellular',
  [Transport.wired]: 'Wired',
  [Transport.other]: 'Other',
  [Transport.none]: 'None',
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Props {
  pack: Pack;
  /** Mount to first frame of the cloud; null while it loads. */
  loadedMs: number | null;
}

/** What the app is running on right now, read from the same events the UI reacts to. */
export function DevPanel({ pack, loadedMs }: Props) {
  const mode = useInstructorMode();
  const agent = useAgentStatus();
  const network = useNetwork();
  const sections = [
    {
      title: DevCopy.assistant,
      rows: [
        [DevCopy.mode, ModeText[mode.mode]],
        [DevCopy.voice, VoiceText[mode.voice]],
        [DevCopy.answers, AnswerText[mode.answers]],
        [
          DevCopy.agent,
          agent.reason === null
            ? AgentText[agent.state]
            : `${AgentText[agent.state]}, ${FailureText[agent.reason]}`,
        ],
      ],
    },
    {
      title: DevCopy.network,
      rows: [
        [DevCopy.quality, QualityText[network.quality]],
        [DevCopy.link, TransportText[network.transport]],
        [DevCopy.reason, sentence(network.reason)],
      ],
    },
    {
      title: DevCopy.cloud,
      rows: [
        [
          DevCopy.splats,
          String(pack.tiers[0].splatCount).replace(THOUSANDS, ','),
        ],
        [DevCopy.pack, `${pack.packId} v${pack.packVersion}`],
        [
          DevCopy.loaded,
          loadedMs === null
            ? DevCopy.loading
            : `${(loadedMs / MS_PER_SECOND).toFixed(1)} s`,
        ],
      ],
    },
  ] as const;

  return (
    <View style={styles.panel}>
      <Text style={styles.title} accessibilityRole="header">
        {DevCopy.title}
      </Text>
      {sections.map(section => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.heading}>{section.title}</Text>
          {section.rows.map(([label, value]) => (
            <View
              key={label}
              style={styles.row}
              accessible
              accessibilityLabel={`${label}, ${value}`}
            >
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Space.md },
  title: { ...Type.headline, color: Color.text },
  section: { gap: Space.xs },
  heading: { ...Type.label, color: Color.muted },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  label: { ...Type.callout, color: Color.secondaryText },
  value: {
    ...Type.callout,
    fontVariant: ['tabular-nums'],
    color: Color.text,
    flexShrink: 1,
    textAlign: 'right',
  },
});

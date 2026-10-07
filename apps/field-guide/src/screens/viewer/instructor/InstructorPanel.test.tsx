import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { appEvents } from '../../../features/events/bus';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  ModeRequestType,
  VoiceSource,
  type ModeStatus,
} from '../../../features/events/types';
import { INITIAL_SESSION } from '../../../features/guide/session';
import {
  VoiceState,
  type InstructorVoice,
} from '../../../features/instructor/voice/useInstructorVoice';
import { SpokenSection } from '../../../features/instructor/voice/speechPresentation';
import { fixturePack } from '../../../testing/fixturePack';
import { cardContentFor } from '../guideContent';
import { EntryKind, ExchangePhase, type Exchange } from '../viewerState';
import { InstructorPanel } from './InstructorPanel';
import { PanelMode } from './panelMotion';

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: jest.fn(config => ({ kind: 'pan', config })),
}));

const ONLINE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
  forced: false,
};
const CONTENT = cardContentFor(INITIAL_SESSION, fixturePack());
const EXCHANGE_ID = 1;
const noop = () => {};
type PanelProps = React.ComponentProps<typeof InstructorPanel>;

function Panel({
  voice: overrides,
  ...props
}: Partial<Omit<PanelProps, 'voice'>> & { voice?: Partial<InstructorVoice> }) {
  const level = useSharedValue(0);
  const voice: InstructorVoice = {
    state: VoiceState.idle,
    on: false,
    muted: false,
    open: false,
    toggle: noop,
    toggleMuted: noop,
    transcript: '',
    hint: '',
    word: null,
    section: SpokenSection.reply,
    level,
    stop: noop,
    interrupt: noop,
    ...overrides,
  };
  return (
    <InstructorPanel
      thread={[]}
      exchange={null}
      content={CONTENT}
      bottomInset={0}
      onAsk={noop}
      voice={voice}
      mode={PanelMode.expanded}
      onModeChange={noop}
      onBack={noop}
      onNext={noop}
      {...props}
    />
  );
}

describe('instructor panel modes', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const mode = async (status: Partial<ModeStatus>) => {
    await act(() => appEvents.emit('mode', { ...ONLINE, ...status }));
  };
  const mount = async (props: React.ComponentProps<typeof Panel> = {}) => {
    await act(() => {
      renderer = ReactTestRenderer.create(<Panel {...props} />);
    });
  };
  const text = (testID: string) =>
    renderer.root.findAllByProps({ testID }).find(node => node.type === Text)!
      .props.children;
  const toggle = () =>
    renderer.root
      .findAllByProps({ testID: 'instructor-mode-toggle' })
      .find(node => node.props.accessibilityRole === 'button')!;

  beforeEach(async () => {
    jest.mocked(useReducedMotion).mockReturnValue(false);
    await mode({});
    await act(() => appEvents.emit('modeSuggestion', null));
  });
  afterEach(async () => {
    await act(() => renderer?.unmount());
  });

  test('the open header lets the user force offline and allow online, hiding the toggle during switches', async () => {
    const requests: string[] = [];
    const unsubscribe = appEvents.on('modeRequest', request =>
      requests.push(request.type),
    );
    try {
      await mount();
      expect(text('instructor-mode-toggle-label')).toBe('Go offline');
      expect(toggle().props.accessibilityHint).toBeTruthy();
      await act(() => toggle().props.onPress());
      await mode({
        mode: InstructorMode.offline,
        forced: true,
        answers: AnswerSource.script,
      });
      expect(
        renderer.root
          .findAllByType(Text)
          .some(node => node.props.children === 'Offline'),
      ).toBe(true);
      expect(text('instructor-mode-toggle-label')).toBe('Go online');
      await act(() => toggle().props.onPress());
      expect(requests).toEqual([
        ModeRequestType.forceOffline,
        ModeRequestType.allowOnline,
      ]);
      for (const switching of [
        InstructorMode.switchingToOnline,
        InstructorMode.switchingToOffline,
      ]) {
        await mode({ mode: switching });
        expect(toggle()).toBeUndefined();
      }
    } finally {
      unsubscribe();
    }
  });

  test('the minimized header shows Offline when idle and switch titles while preserving active voice status', async () => {
    await mount({ mode: PanelMode.minimized });
    expect(toggle()).toBeUndefined();
    await mode({ mode: InstructorMode.offline, answers: AnswerSource.script });
    expect(text('instructor-status')).toBe('Offline');
    await act(() =>
      renderer.update(
        <Panel
          mode={PanelMode.minimized}
          voice={{ on: true, state: VoiceState.speaking }}
        />,
      ),
    );
    expect(text('instructor-status')).toBe('Speaking');
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    expect(text('instructor-status')).toBe(
      'Connection lost. Switching to offline.',
    );
    await mode({
      mode: InstructorMode.switchingToOnline,
      cause: ModeCause.recovered,
    });
    expect(text('instructor-status')).toBe(
      'Back online. Switching to online voice.',
    );
    await mode({});
    expect(text('instructor-status')).toBe('Speaking');
  });

  test('a cut-off reply keeps its words and includes Interrupted in the answer accessibility label', async () => {
    const exchange: Exchange = {
      id: EXCHANGE_ID,
      question: 'What does it do?',
      reply: 'It supplies the starter.',
      caution: '',
      part: null,
      phase: ExchangePhase.done,
      interrupted: true,
    };
    await mount({ exchange });
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Interrupted'),
    ).toBe(true);
    expect(
      renderer.root
        .findAllByProps({
          accessibilityLabel: 'It supplies the starter. Interrupted',
        })
        .some(node => node.props.accessible),
    ).toBe(true);
    await act(() =>
      renderer.update(
        <Panel thread={[{ kind: EntryKind.exchange, exchange }]} />,
      ),
    );
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Interrupted'),
    ).toBe(true);
    await act(() =>
      renderer.update(<Panel exchange={{ ...exchange, interrupted: false }} />),
    );
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Interrupted'),
    ).toBe(false);
    await act(() =>
      renderer.update(
        <Panel
          exchange={{ ...exchange, reply: '', phase: ExchangePhase.pending }}
        />,
      ),
    );
    expect(
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Interrupted' })
        .some(node => node.props.accessible),
    ).toBe(true);
    expect(
      renderer.root.findAllByProps({ testID: 'instructor-thinking' }),
    ).toHaveLength(0);
  });
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { appEvents } from '../../../features/events/bus';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
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

function readout(
  node:
    | ReactTestRenderer.ReactTestRendererJSON
    | ReactTestRenderer.ReactTestRendererJSON[]
    | string
    | null,
): string[] {
  if (node === null) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(readout);
  }
  if (typeof node === 'string') {
    return [node];
  }
  if (node.props.accessible === false) {
    return [];
  }
  // Accessible native parents group their children for the screen reader.
  if (
    node.props.accessibilityLabel &&
    (node.props.accessible || node.type === 'Text')
  ) {
    return [node.props.accessibilityLabel];
  }
  return (node.children ?? []).flatMap(readout);
}

const INTERRUPTED_EXCHANGE: Exchange = {
  id: EXCHANGE_ID,
  question: 'What should I do?',
  reply: '1. Check the cap.\n2. Turn it slowly.',
  caution: '',
  part: null,
  phase: ExchangePhase.done,
  interrupted: true,
};

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
  const hasText = (text: string) =>
    renderer.root
      .findAllByType(Text)
      .some(node => node.props.children === text);
  const button = (label: string) =>
    renderer.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.findAllByType(Text).some(text => text.props.children === label),
    )[0];

  beforeEach(async () => {
    jest.mocked(useReducedMotion).mockReturnValue(false);
    await mode({});
    await act(() => appEvents.emit('modeSuggestion', null));
  });
  afterEach(async () => {
    await act(() => renderer?.unmount());
  });

  test('Go offline explains and requests on-device voice and answers', async () => {
    const requests: string[] = [];
    const unsubscribe = appEvents.on('modeRequest', request =>
      requests.push(request.type),
    );
    try {
      await mount();
      expect(button('Go offline').props.accessibilityHint).toBe(
        'Uses the on-device voice and answers until you go online.',
      );
      await act(() => button('Go offline').props.onPress());
      expect(requests).toEqual(['forceOffline']);
    } finally {
      unsubscribe();
    }
  });

  test('Go online explains and requests automatic online recovery', async () => {
    const requests: string[] = [];
    const unsubscribe = appEvents.on('modeRequest', request =>
      requests.push(request.type),
    );
    try {
      await mode({
        mode: InstructorMode.offline,
        forced: true,
        answers: AnswerSource.script,
      });
      await mount();
      expect(button('Go online').props.accessibilityHint).toBe(
        'Uses the online voice again when the connection is good.',
      );
      await act(() => button('Go online').props.onPress());
      expect(requests).toEqual(['allowOnline']);
    } finally {
      unsubscribe();
    }
  });

  test.each([
    InstructorMode.switchingToOffline,
    InstructorMode.switchingToOnline,
  ])('the toggle is hidden during %s', async switching => {
    await mode({ mode: switching });
    await mount();
    expect(button('Go offline')).toBeUndefined();
    expect(button('Go online')).toBeUndefined();
  });

  test('the minimized panel has no mode toggle', async () => {
    await mount({ mode: PanelMode.minimized });
    expect(button('Go offline')).toBeUndefined();
  });

  test('an idle minimized panel reads Offline', async () => {
    await mode({ mode: InstructorMode.offline, answers: AnswerSource.script });
    await mount({ mode: PanelMode.minimized });
    expect(hasText('Offline')).toBe(true);
  });

  test.each([
    { state: VoiceState.speaking, label: 'Speaking' },
    { state: VoiceState.thinking, label: 'Thinking' },
    { state: VoiceState.listening, label: 'Listening' },
  ])(
    'an offline minimized panel keeps $label while voice is active',
    async ({ state, label }) => {
      await mode({
        mode: InstructorMode.offline,
        answers: AnswerSource.script,
      });
      await mount({ mode: PanelMode.minimized, voice: { on: true, state } });
      expect(hasText(label)).toBe(true);
    },
  );

  test.each([
    {
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
      title: 'Connection lost. Switching to offline.',
    },
    {
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.user,
      title: 'Switching to offline.',
    },
    {
      mode: InstructorMode.switchingToOnline,
      cause: ModeCause.recovered,
      title: 'Back online. Switching to online voice.',
    },
    {
      mode: InstructorMode.switchingToOnline,
      cause: ModeCause.user,
      title: 'Switching to online voice.',
    },
  ])(
    'the minimized panel reads $title',
    async ({ mode: nextMode, cause, title }) => {
      await mode({ mode: nextMode, cause });
      await mount({ mode: PanelMode.minimized });
      expect(hasText(title)).toBe(true);
    },
  );

  test('an interrupted reply keeps separate spoken item labels', async () => {
    await mount({ exchange: INTERRUPTED_EXCHANGE });
    expect(readout(renderer.toJSON())).toEqual(
      expect.arrayContaining(['Check the cap.', 'Turn it slowly. Interrupted']),
    );
    expect(hasText('Interrupted')).toBe(true);
  });

  test('an earlier interrupted exchange keeps its visible label', async () => {
    await mount({
      thread: [{ kind: EntryKind.exchange, exchange: INTERRUPTED_EXCHANGE }],
    });
    expect(hasText('Interrupted')).toBe(true);
  });

  test('a completed reply has no interrupted label', async () => {
    await mount({ exchange: { ...INTERRUPTED_EXCHANGE, interrupted: false } });
    expect(hasText('Interrupted')).toBe(false);
  });

  test('an interruption before the first word reads Interrupted', async () => {
    await mount({
      exchange: {
        ...INTERRUPTED_EXCHANGE,
        reply: '',
        phase: ExchangePhase.pending,
      },
    });
    expect(readout(renderer.toJSON())).toContain('Interrupted');
    expect(readout(renderer.toJSON())).not.toContain('Thinking');
  });
});

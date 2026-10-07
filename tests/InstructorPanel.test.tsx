import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { appEvents } from '../apps/field-guide/src/features/events/bus';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  VoiceSource,
  type ModeStatus,
} from '../apps/field-guide/src/features/events/types';
import { INITIAL_SESSION } from '../apps/field-guide/src/features/guide/session';
import {
  VoiceState,
  type InstructorVoice,
} from '../apps/field-guide/src/features/instructor/voice/useInstructorVoice';
import { SpokenSection } from '../apps/field-guide/src/features/instructor/voice/speechPresentation';
import { fixturePack } from './fixturePack';
import { cardContentFor } from '../apps/field-guide/src/screens/viewer/guideContent';
import {
  EntryKind,
  ExchangePhase,
  type Exchange,
} from '../apps/field-guide/src/screens/viewer/viewerState';
import { InstructorPanel } from '../apps/field-guide/src/screens/viewer/instructor/InstructorPanel';
import { PanelMode } from '../apps/field-guide/src/screens/viewer/instructor/panelMotion';

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
const THREAD_SIZE = { width: 300, height: 600 };
const THREAD_WINDOW = { width: 300, height: 200 };
const THREAD_SCROLLED_Y = 20;
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
    ask: () => false,
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

  test('Stay offline keeps on-device voice and answers when a lost connection returns', async () => {
    const requests: string[] = [];
    const unsubscribe = appEvents.on('modeRequest', request =>
      requests.push(request.type),
    );
    try {
      await mode({
        mode: InstructorMode.offline,
        cause: ModeCause.network,
        answers: AnswerSource.script,
      });
      await mount();
      expect(button('Stay offline').props.accessibilityHint).toBe(
        'Keeps the on-device voice and answers when the connection returns.',
      );
      await act(() => button('Stay offline').props.onPress());
      expect(requests).toEqual(['forceOffline']);
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

  test('Stop instructor has a visible button frame and stops the reply', async () => {
    const stop = jest.fn();
    await mount({ voice: { state: VoiceState.speaking, stop } });
    const control = renderer.root
      .findAllByType(View)
      .find(node => node.props.testID === 'instructor-stop')!;
    expect(control.props.accessibilityLabel).toBe('Stop instructor');
    const style = StyleSheet.flatten(control.props.style);
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.backgroundColor).not.toBe('transparent');
    const action = renderer.root.findAll(
      node =>
        node.props.testID === 'instructor-stop' &&
        typeof node.props.onPress === 'function',
    )[0];
    await act(() => action.props.onPress());
    expect(stop).toHaveBeenCalled();
  });

  test.each([
    {
      mode: PanelMode.expanded,
      id: 'instructor-voice-status',
      reducedMotion: false,
    },
    {
      mode: PanelMode.minimized,
      id: 'instructor-status',
      reducedMotion: false,
    },
    {
      mode: PanelMode.expanded,
      id: 'instructor-voice-status',
      reducedMotion: true,
    },
    { mode: PanelMode.minimized, id: 'instructor-status', reducedMotion: true },
  ])(
    '$mode keeps one persistent status label when listening starts (Reduce Motion: $reducedMotion)',
    async ({ mode: panelMode, id, reducedMotion }) => {
      jest.mocked(useReducedMotion).mockReturnValue(reducedMotion);
      await mount({ mode: panelMode, voice: { on: true } });
      const labels = () =>
        renderer.root
          .findAllByType(Text)
          .filter(node => node.props.testID === id);
      const label = labels()[0];
      expect(label.props.children).toBe('Starting');
      await act(() =>
        renderer.update(
          <Panel
            mode={panelMode}
            voice={{ on: true, open: true, state: VoiceState.listening }}
          />,
        ),
      );
      expect(labels()).toHaveLength(1);
      expect(labels()[0].props.children).toBe('Listening');
      expect(labels()[0]).toBe(label);
      await act(() => renderer.update(<Panel mode={panelMode} />));
      expect(hasText('Starting')).toBe(false);
      expect(hasText('Listening')).toBe(false);
    },
  );

  test('an idle minimized panel reads Offline', async () => {
    await mode({ mode: InstructorMode.offline, answers: AnswerSource.script });
    await mount({ mode: PanelMode.minimized });
    expect(hasText('Offline')).toBe(true);
  });

  test.each([
    {
      id: 'instructor-hint',
      mode: PanelMode.expanded,
      before: { hint: 'Microphone unavailable.' },
      after: { hint: 'Voice unavailable.' },
      label: 'Voice unavailable.',
    },
    {
      id: 'instructor-cue',
      mode: PanelMode.expanded,
      before: { on: true },
      after: { on: true, muted: true },
      label: 'Muted. Tap the mic to listen again.',
    },
    {
      id: 'instructor-preview',
      mode: PanelMode.minimized,
      before: { hint: 'Microphone unavailable.' },
      after: { hint: 'Voice unavailable.' },
      label: 'Voice unavailable.',
    },
  ])(
    '$id replaces content in place and preserves its live region',
    async ({ id, mode: panelMode, before, after, label }) => {
      await mount({ mode: panelMode, voice: before });
      const labels = () =>
        renderer.root
          .findAllByType(Text)
          .filter(node => node.props.testID === id);
      const original = labels()[0];
      await act(() =>
        renderer.update(<Panel mode={panelMode} voice={after} />),
      );
      expect(labels()).toHaveLength(1);
      expect(labels()[0]).toBe(original);
      expect(labels()[0].props.accessibilityLiveRegion).toBe('polite');
      expect(
        labels()[0].props.accessibilityLabel ?? labels()[0].props.children,
      ).toBe(label);
    },
  );

  test('an idle minimized panel reads the online voice fallback title', async () => {
    await mode({ voice: VoiceSource.device });
    await mount({ mode: PanelMode.minimized });
    expect(hasText('Online voice unavailable')).toBe(true);
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

  test('an interrupted numbered reply keeps an unfinished next marker out of the readout', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    await mount({
      exchange: {
        ...INTERRUPTED_EXCHANGE,
        reply: '1. Check the cap.\n2',
        phase: ExchangePhase.streaming,
      },
    });
    expect(readout(renderer.toJSON())).toContain('Check the cap. Interrupted');
    expect(hasText('2')).toBe(false);
  });

  test('an earlier interrupted exchange keeps its visible label', async () => {
    await mount({
      thread: [{ kind: EntryKind.exchange, exchange: INTERRUPTED_EXCHANGE }],
    });
    expect(hasText('Interrupted')).toBe(true);
  });

  test('the thread fades its top edge only while scrolled away from the top', async () => {
    await mode({ mode: InstructorMode.offline, answers: AnswerSource.script });
    const rendered = jest.fn();
    await act(() => {
      renderer = ReactTestRenderer.create(
        <React.Profiler id="instructor" onRender={rendered}>
          <Panel exchange={INTERRUPTED_EXCHANGE} />
        </React.Profiler>,
      );
    });
    const fades = () =>
      renderer.root.findAllByProps({ testID: 'instructor-thread-top-fade' });
    const scroll = async (y: number) => {
      await act(() =>
        renderer.root.findByType(ScrollView).props.onScroll({
          nativeEvent: {
            contentOffset: { x: 0, y },
            contentSize: THREAD_SIZE,
            layoutMeasurement: THREAD_WINDOW,
          },
        }),
      );
    };
    expect(fades()).toHaveLength(0);
    await scroll(THREAD_SCROLLED_Y);
    expect(fades().length).toBeGreaterThan(0);
    expect(fades()[0].props.pointerEvents).toBe('none');
    rendered.mockClear();
    await scroll(THREAD_SCROLLED_Y + THREAD_SCROLLED_Y);
    await scroll(THREAD_SCROLLED_Y);
    expect(rendered).not.toHaveBeenCalled();
    await scroll(0);
    expect(fades()).toHaveLength(0);
    rendered.mockClear();
    await scroll(0);
    await scroll(-THREAD_SCROLLED_Y);
    expect(fades()).toHaveLength(0);
    expect(rendered).not.toHaveBeenCalled();
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

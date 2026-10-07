import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type KeyboardEvent,
} from 'react-native';
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
import { AssistantDock } from '../apps/field-guide/src/screens/viewer/assistant/AssistantDock';

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: jest.fn(config => ({ kind: 'pan', config })),
}));

const ONLINE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
};
const CONTENT = cardContentFor(INITIAL_SESSION, fixturePack());
const EXCHANGE_ID = 1;
const THREAD_SIZE = { width: 300, height: 600 };
const THREAD_WINDOW = { width: 300, height: 200 };
const THREAD_SCROLLED_Y = 20;
const noop = () => {};
type PanelProps = React.ComponentProps<typeof InstructorPanel>;

function useVoice(overrides?: Partial<InstructorVoice>): InstructorVoice {
  const level = useSharedValue(0);
  return {
    state: VoiceState.idle,
    on: false,
    muted: false,
    open: false,
    toggle: noop,
    toggleMuted: noop,
    transcript: '',
    hint: '',
    section: SpokenSection.reply,
    level,
    stop: noop,
    interrupt: noop,
    ask: () => false,
    ...overrides,
  };
}

function Panel({
  voice: overrides,
  ...props
}: Partial<Omit<PanelProps, 'voice'>> & { voice?: Partial<InstructorVoice> }) {
  const voice = useVoice(overrides);
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

type DockProps = React.ComponentProps<typeof AssistantDock>;
function Dock({
  voice: overrides,
  ...props
}: Partial<Omit<DockProps, 'voice'>> & { voice?: Partial<InstructorVoice> }) {
  const voice = useVoice(overrides);
  return (
    <AssistantDock
      thread={[]}
      exchange={null}
      alreadyShown={[]}
      onAsk={noop}
      voice={voice}
      expanded={false}
      onExpandedChange={noop}
      bottomInset={0}
      maxHeight={440}
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
  beforeEach(async () => {
    jest.mocked(useReducedMotion).mockReturnValue(false);
    await mode({});
    await act(() => appEvents.emit('modeSuggestion', null));
  });
  afterEach(async () => {
    await act(() => renderer?.unmount());
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

  test('the thread keeps its end in view when it resizes, unless the reader scrolled back', async () => {
    await mount({ exchange: INTERRUPTED_EXCHANGE });
    const thread = renderer.root.findByType(ScrollView);
    const scrollToEnd = jest.mocked(thread.instance.scrollToEnd);
    const resize = async () => {
      await act(() =>
        thread.props.onLayout({ nativeEvent: { layout: THREAD_WINDOW } }),
      );
    };
    const atTop = {
      nativeEvent: {
        contentOffset: { x: 0, y: 0 },
        contentSize: THREAD_SIZE,
        layoutMeasurement: THREAD_WINDOW,
      },
    };
    scrollToEnd.mockClear();
    await resize();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    // A reply that outgrows the scroll to the end does not stop the follow.
    await act(() => thread.props.onScroll(atTop));
    scrollToEnd.mockClear();
    await resize();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    // The end of a programmatic animated scroll is not the reader's momentum.
    await act(() => thread.props.onMomentumScrollEnd(atTop));
    scrollToEnd.mockClear();
    await resize();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    await act(() => thread.props.onScrollBeginDrag());
    await act(() => thread.props.onScrollEndDrag(atTop));
    scrollToEnd.mockClear();
    await resize();
    expect(scrollToEnd).not.toHaveBeenCalled();
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

  test.each([false, true])(
    'the assistant expands, sends trimmed questions and retains voice controls (Reduce Motion: %s)',
    async reducedMotion => {
      jest.mocked(useReducedMotion).mockReturnValue(reducedMotion);
      const onExpandedChange = jest.fn();
      const onAsk = jest.fn();
      const toggle = jest.fn();
      const toggleMuted = jest.fn();
      const stop = jest.fn();
      const props = {
        onExpandedChange,
        onAsk,
        voice: { toggle, toggleMuted, stop },
      };
      await act(() => {
        renderer = ReactTestRenderer.create(<Dock {...props} />);
      });
      const control = (id: string) =>
        renderer.root.findAll(
          node =>
            node.props.testID === id &&
            typeof node.props.onPress === 'function',
        )[0];
      expect(control('assistant-expand').props.accessibilityLabel).toBe(
        'AI Assistant',
      );
      expect(control('assistant-expand').props.accessibilityState).toEqual({
        expanded: false,
      });
      expect(hasText('Tap to talk')).toBe(true);
      expect(control('assistant-send')).toBeUndefined();
      await act(() => control('assistant-expand').props.onPress());
      expect(onExpandedChange).toHaveBeenLastCalledWith(true);
      await act(() => control('assistant-mic').props.onPress());
      expect(toggle).toHaveBeenCalledTimes(1);
      await act(() => renderer.update(<Dock {...props} expanded />));
      expect(
        renderer.root.findAll(node => node.props.testID === 'assistant-dock')[0]
          .props.layout === undefined,
      ).toBe(reducedMotion);
      expect(control('assistant-minimize').props.accessibilityState).toEqual({
        expanded: true,
      });
      expect(control('assistant-send').props.accessibilityState.disabled).toBe(
        true,
      );
      const input = renderer.root.findByProps({ testID: 'assistant-input' });
      await act(() => input.props.onChangeText('  What should I check?  '));
      await act(() => control('assistant-send').props.onPress());
      expect(onAsk).toHaveBeenCalledWith('What should I check?');
      expect(
        renderer.root.findByProps({ testID: 'assistant-input' }).props.value,
      ).toBe('');
      onExpandedChange.mockClear();
      await act(() =>
        renderer.update(
          <Dock
            {...props}
            voice={{
              ...props.voice,
              on: true,
              open: true,
              state: VoiceState.speaking,
            }}
          />,
        ),
      );
      expect(onExpandedChange).toHaveBeenCalledWith(true);
      await act(() =>
        renderer.update(
          <Dock
            {...props}
            expanded
            voice={{
              ...props.voice,
              on: true,
              open: true,
              state: VoiceState.speaking,
            }}
          />,
        ),
      );
      expect(hasText('Speaking')).toBe(true);
      expect(
        renderer.root.findAllByProps({ testID: 'instructor-meter' }).length,
      ).toBeGreaterThan(0);
      await act(() => control('assistant-mic').props.onPress());
      expect(toggleMuted).toHaveBeenCalledTimes(1);
      await act(() => control('assistant-stop').props.onPress());
      expect(stop).toHaveBeenCalledTimes(1);
      await act(() => control('assistant-end-voice').props.onPress());
      expect(toggle).toHaveBeenCalledTimes(2);
      await act(() => control('assistant-minimize').props.onPress());
      expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    },
  );

  test('assistant bubbles omit repeated cards, steps and cautions while preserving question order', async () => {
    const content = {
      ...CONTENT,
      title: 'Coolant tank',
      body: 'Read the level through the tank wall.',
      caution: 'Wait until the engine is cold.',
    };
    const question = {
      ...INTERRUPTED_EXCHANGE,
      interrupted: false,
      readsStep: true,
      reply: content.body,
      caution: content.caution,
    };
    const reply = {
      ...INTERRUPTED_EXCHANGE,
      id: 2,
      interrupted: false,
      question: 'What else?',
      reply: `${content.body} Look for a leak.`,
      caution: content.caution,
    };
    await act(() => {
      renderer = ReactTestRenderer.create(
        <Dock
          expanded
          alreadyShown={[content.title, content.body, content.caution]}
          thread={[
            { kind: EntryKind.step, id: 1, key: 'step', card: content },
            { kind: EntryKind.exchange, exchange: question },
          ]}
          exchange={reply}
          voice={{
            on: true,
            state: VoiceState.speaking,
          }}
        />,
      );
    });
    const labels = readout(renderer.toJSON());
    expect(labels).not.toContain(content.title);
    expect(labels).not.toContain(content.body);
    expect(labels).not.toContain(`Caution: ${content.caution}`);
    expect(
      labels.filter(text =>
        [question.question, reply.question, 'Look for a leak.'].includes(text),
      ),
    ).toEqual([question.question, reply.question, 'Look for a leak.']);
    const bubbles = () =>
      renderer.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.testID === 'thread-bubble',
      );
    expect(bubbles()).toHaveLength(3);
    await act(() =>
      renderer.update(
        <Dock
          expanded
          alreadyShown={[content.title, content.body, content.caution]}
          exchange={{ ...reply, reply: content.body, caution: '' }}
        />,
      ),
    );
    expect(bubbles()).toHaveLength(1);
    await act(() =>
      renderer.update(
        <Dock
          expanded
          alreadyShown={[content.title, content.body, content.caution]}
          exchange={{
            ...reply,
            reply: content.body.slice(0, 20),
            caution: '',
            phase: ExchangePhase.streaming,
          }}
        />,
      ),
    );
    expect(bubbles()).toHaveLength(1);
  });

  test('the assistant measures keyboard overlap without offsetting an already resized stage twice', async () => {
    let update: ((event: KeyboardEvent) => void) | undefined;
    let hide: ((event: KeyboardEvent) => void) | undefined;
    const listeners = jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((name, callback) => {
        if (name === 'keyboardWillChangeFrame') {
          update = callback;
        }
        if (name === 'keyboardWillHide') {
          hide = callback;
        }
        return { remove: jest.fn() };
      });
    let anchorBottom = 900;
    try {
      await act(() => {
        renderer = ReactTestRenderer.create(<Dock expanded />);
      });
      const anchor = renderer.root
        .findAllByType(View)
        .find(node => node.props.testID === 'assistant-anchor')!;
      jest
        .mocked(anchor.instance.measureInWindow)
        .mockImplementation(
          (
            callback: (
              x: number,
              y: number,
              width: number,
              height: number,
            ) => void,
          ) => callback(800, anchorBottom - 440, 380, 440),
        );
      const event: KeyboardEvent = {
        duration: 250,
        easing: 'keyboard',
        isEventFromThisApp: true,
        startCoordinates: {
          screenX: 0,
          screenY: 1000,
          width: 1200,
          height: 350,
        },
        endCoordinates: { screenX: 0, screenY: 650, width: 1200, height: 350 },
      };
      await act(() => update?.(event));
      await act(() => renderer.update(<Dock expanded />));
      const dockStyle = () =>
        StyleSheet.flatten(
          renderer.root
            .findAllByType(View)
            .find(node => node.props.testID === 'assistant-dock')!.props.style,
        );
      expect(dockStyle().transform).toEqual([{ translateY: -262 }]);
      expect(dockStyle().height).toBeLessThanOrEqual(440 - 262);
      anchorBottom = 1020;
      await act(() => update?.(event));
      await act(() => renderer.update(<Dock expanded />));
      expect(dockStyle().height).toBe(144);
      expect(
        renderer.root.findByProps({ testID: 'assistant-input' }),
      ).toBeDefined();
      anchorBottom = 620;
      await act(() =>
        renderer.root
          .findByProps({ testID: 'assistant-anchor' })
          .props.onLayout(),
      );
      await act(() => renderer.update(<Dock expanded />));
      expect(dockStyle().transform).toEqual([{ translateY: -0 }]);
      await act(() => hide?.(event));
    } finally {
      listeners.mockRestore();
    }
  });
});

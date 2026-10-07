import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { appEvents } from '../apps/field-guide/src/features/events/bus';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  SwitchPiece,
  SwitchStepState,
  VoiceSource,
  type ModeStatus,
} from '../apps/field-guide/src/features/events/types';
import { ModeArea } from '../apps/field-guide/src/screens/viewer/instructor/ModeArea';

const ONLINE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
};
const SWITCH_ID_INCREMENT = 1;
const INITIAL_SWITCH_ID = 0;
const OFFLINE_MODEL =
  'Answers come from the on-device model, which this device limits. Keep questions short. Goes online when the connection returns.';
const OFFLINE_SCRIPT =
  "Answers come from the guide's script. Goes online when the connection returns.";

describe('instructor mode area', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  let switchId = INITIAL_SWITCH_ID;
  const hasText = (text: string) =>
    renderer.root
      .findAllByType(Text)
      .some(node => node.props.children === text);
  const mode = async (status: Partial<ModeStatus>) => {
    await act(() => appEvents.emit('mode', { ...ONLINE, ...status }));
  };
  const step = async (
    piece: SwitchPiece,
    label: string,
    state: SwitchStepState = SwitchStepState.starting,
    id = switchId,
  ) => {
    await act(() =>
      appEvents.emit('switchStep', { switchId: id, piece, state, label }),
    );
  };
  const suggest = async () => {
    await act(() =>
      appEvents.emit('modeSuggestion', {
        mode: InstructorMode.offline,
        reason: 'weak signal',
      }),
    );
  };
  const mount = async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(<ModeArea />);
    });
  };
  const button = (label: string) =>
    renderer.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.findAllByType(Text).some(text => text.props.children === label),
    )[0];
  const banners = () =>
    renderer.root.findAllByType(View).filter(node => {
      const style = StyleSheet.flatten(node.props.style);
      return (style?.borderLeftWidth ?? 0) > 0;
    });
  const finishSwitch = async (
    settledMode: InstructorMode = InstructorMode.online,
  ) => {
    await mode({
      mode: InstructorMode.switchingToOnline,
      cause: ModeCause.recovered,
    });
    await step(SwitchPiece.voice, 'Voice: ElevenLabs', SwitchStepState.ready);
    await mode({ mode: settledMode });
    switchId += SWITCH_ID_INCREMENT;
  };

  beforeEach(async () => {
    switchId += SWITCH_ID_INCREMENT;
    jest.mocked(useReducedMotion).mockReturnValue(false);
    await mode({});
    await act(() => appEvents.emit('modeSuggestion', null));
  });
  afterEach(async () => {
    await act(() => renderer?.unmount());
  });

  test('agent voice online takes no panel space', async () => {
    await mount();
    expect(renderer.toJSON()).toBeNull();
  });

  test.each([
    {
      status: { voice: VoiceSource.device },
      title: 'Online voice unavailable',
      detail: 'Using on-device voice.',
    },
    {
      status: {
        mode: InstructorMode.offline,
        answers: AnswerSource.deviceModel,
      },
      title: null,
      detail: OFFLINE_MODEL,
    },
    {
      status: { mode: InstructorMode.offline, answers: AnswerSource.script },
      title: null,
      detail: OFFLINE_SCRIPT,
    },
  ])('shows $detail', async ({ status, title, detail }) => {
    await mount();
    await mode(status);
    expect(hasText(detail)).toBe(true);
    // Offline, the header already names the mode.
    expect(hasText(title ?? 'Offline')).toBe(title !== null);
  });

  test('weak signal takes priority over the online voice fallback notice', async () => {
    await mount();
    await mode({ voice: VoiceSource.device });
    await suggest();
    expect(hasText('Weak signal')).toBe(true);
    expect(hasText('Switch to offline?')).toBe(true);
    expect(hasText('Online voice unavailable')).toBe(false);
  });

  test.each([false, true])(
    'one persistent banner replaces the suggestion with switching and offline content (Reduce Motion: %s)',
    async reducedMotion => {
      jest.mocked(useReducedMotion).mockReturnValue(reducedMotion);
      await mount();
      await suggest();
      const banner = banners()[0];
      await mode({
        mode: InstructorMode.switchingToOffline,
        cause: ModeCause.network,
      });
      expect(banners()).toHaveLength(1);
      expect(banners()[0]).toBe(banner);
      expect(banner.props.entering).toBeUndefined();
      expect(banner.props.exiting).toBeUndefined();
      expect(hasText('Connection lost. Switching to offline.')).toBe(true);
      expect(button('Switch')).toBeUndefined();
      expect(button('Keep online')).toBeUndefined();
      await mode({
        mode: InstructorMode.offline,
        answers: AnswerSource.script,
      });
      expect(banners()).toHaveLength(1);
      expect(banners()[0]).toBe(banner);
      expect(hasText(OFFLINE_SCRIPT)).toBe(true);
      expect(hasText('Connection lost. Switching to offline.')).toBe(false);
    },
  );

  test.each([
    { label: 'Switch', request: 'acceptSuggestion' },
    { label: 'Keep online', request: 'dismissSuggestion' },
  ])('$label requests $request', async ({ label, request }) => {
    const requests: string[] = [];
    const unsubscribe = appEvents.on('modeRequest', intent =>
      requests.push(intent.type),
    );
    try {
      await mount();
      await suggest();
      await act(() => button(label).props.onPress());
      expect(requests).toEqual([request]);
    } finally {
      unsubscribe();
    }
  });

  test('weak signal suggestions stay hidden offline', async () => {
    await mount();
    await suggest();
    await mode({ mode: InstructorMode.offline, answers: AnswerSource.script });
    expect(hasText('Weak signal')).toBe(false);
    expect(hasText(OFFLINE_SCRIPT)).toBe(true);
  });

  test('switch progress appears in emission order', async () => {
    await mount();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    await step(SwitchPiece.voice, 'Voice: Kokoro');
    expect(hasText('Voice: Kokoro')).toBe(true);
    await step(SwitchPiece.answers, 'Answers: on-device model');
    expect(hasText('Answers: on-device model')).toBe(true);
    await step(SwitchPiece.listening, 'Listening: on device');
    expect(
      renderer.root.findAllByType(Text).map(node => node.props.children),
    ).toEqual([
      'Connection lost. Switching to offline.',
      'Voice: Kokoro',
      'Answers: on-device model',
      'Listening: on device',
    ]);
  });

  test('a failed piece replaces its starting label with its fallback', async () => {
    await mount();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    await step(SwitchPiece.voice, 'Voice: Kokoro');
    await step(
      SwitchPiece.voice,
      'Voice: system voice',
      SwitchStepState.fallback,
    );
    expect(hasText('Voice: system voice')).toBe(true);
    expect(hasText('Voice: Kokoro')).toBe(false);
  });

  test('late progress from an older switch is ignored', async () => {
    await mount();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    await step(SwitchPiece.voice, 'Voice: Kokoro');
    await step(
      SwitchPiece.voice,
      'Voice: ElevenLabs',
      SwitchStepState.ready,
      switchId - SWITCH_ID_INCREMENT,
    );
    expect(hasText('Voice: ElevenLabs')).toBe(false);
    expect(hasText('Voice: Kokoro')).toBe(true);
  });

  test('the offline notice replaces a settled switch', async () => {
    await mount();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    await step(SwitchPiece.voice, 'Voice: Kokoro', SwitchStepState.ready);
    await mode({
      mode: InstructorMode.offline,
      answers: AnswerSource.deviceModel,
    });
    expect(hasText('Connection lost. Switching to offline.')).toBe(false);
    expect(hasText('Voice: Kokoro')).toBe(false);
    expect(hasText(OFFLINE_MODEL)).toBe(true);
  });

  test.each([
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
    'a switch shows $title instead of the suggestion',
    async ({ mode: nextMode, cause, title }) => {
      await mount();
      await suggest();
      await mode({ mode: nextMode, cause });
      expect(hasText(title)).toBe(true);
      expect(hasText('Weak signal')).toBe(false);
    },
  );

  test.each([InstructorMode.online, InstructorMode.offline])(
    'a new switch has no old progress after settling %s',
    async settledMode => {
      await mount();
      await finishSwitch(settledMode);
      await mode({
        mode: InstructorMode.switchingToOffline,
        cause: ModeCause.network,
      });
      expect(hasText('Voice: ElevenLabs')).toBe(false);
    },
  );

  test.each(['mode first', 'step first'])(
    'new progress is retained with %s emission order',
    async order => {
      await mount();
      await finishSwitch();
      const startingMode = {
        mode: InstructorMode.switchingToOffline,
        cause: ModeCause.network,
      };
      if (order === 'mode first') {
        await mode(startingMode);
        await step(SwitchPiece.voice, 'Voice: Kokoro');
      } else {
        await step(SwitchPiece.voice, 'Voice: Kokoro');
        await mode(startingMode);
      }
      expect(hasText('Voice: Kokoro')).toBe(true);
      expect(hasText('Voice: ElevenLabs')).toBe(false);
    },
  );

  test('only the switch title is announced as progress arrives', async () => {
    await mount();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    await step(SwitchPiece.voice, 'Voice: Kokoro');
    await step(SwitchPiece.voice, 'Voice: Kokoro', SwitchStepState.ready);
    const announcements = renderer.root
      .findAllByType(Text)
      .filter(node => node.props.accessibilityLiveRegion === 'polite')
      .map(node => node.props.children);
    expect(announcements).toEqual(['Connection lost. Switching to offline.']);
  });

  test('switch progress stays readable with Reduce Motion', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    await mount();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    await step(SwitchPiece.voice, 'Voice: Kokoro');
    expect(hasText('Connection lost. Switching to offline.')).toBe(true);
    expect(hasText('Voice: Kokoro')).toBe(true);
  });
});

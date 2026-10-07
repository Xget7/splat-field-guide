import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { appEvents } from '../../../features/events/bus';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  ModeRequestType,
  SwitchPiece,
  SwitchStepState,
  VoiceSource,
  type ModeStatus,
} from '../../../features/events/types';
import { Color } from '../../../ui/theme';
import { ModeArea } from './ModeArea';

const ONLINE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
  forced: false,
};
const PREVIOUS_SWITCH_ID = 1;
const CURRENT_SWITCH_ID = 2;

describe('instructor mode area', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const hasText = (text: string) =>
    renderer.root
      .findAllByType(Text)
      .some(node => node.props.children === text);
  const mode = async (status: Partial<ModeStatus>) => {
    await act(() => appEvents.emit('mode', { ...ONLINE, ...status }));
  };
  const mount = async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(<ModeArea />);
    });
  };

  beforeEach(async () => {
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
      title: 'Offline',
      detail:
        'Answers come from the on-device model, which this device limits. Keep questions short.',
    },
    {
      status: { mode: InstructorMode.offline, answers: AnswerSource.script },
      title: 'Offline',
      detail: "Answers come from the guide's script.",
    },
  ])('shows $title with $detail', async ({ status, title, detail }) => {
    await mount();
    await mode(status);
    expect(hasText(title)).toBe(true);
    expect(hasText(detail)).toBe(true);
  });

  test('weak signal offers both choices online and stays hidden offline', async () => {
    const requests: string[] = [];
    const unsubscribe = appEvents.on('modeRequest', request =>
      requests.push(request.type),
    );
    try {
      await mount();
      await mode({ voice: VoiceSource.device });
      await act(() =>
        appEvents.emit('modeSuggestion', {
          mode: InstructorMode.offline,
          reason: 'weak signal',
        }),
      );
      expect(hasText('Weak signal')).toBe(true);
      expect(hasText('Switch to offline?')).toBe(true);
      expect(hasText('Online voice unavailable')).toBe(false);
      for (const label of ['Switch', 'Keep online']) {
        const button = renderer.root.findAll(
          node =>
            node.props.accessibilityRole === 'button' &&
            node
              .findAllByType(Text)
              .some(text => text.props.children === label),
        )[0];
        await act(() => button.props.onPress());
      }
      expect(requests).toEqual([
        ModeRequestType.acceptSuggestion,
        ModeRequestType.dismissSuggestion,
      ]);
      await mode({
        mode: InstructorMode.offline,
        answers: AnswerSource.script,
      });
      expect(hasText('Weak signal')).toBe(false);
      expect(hasText('Offline')).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  test('connection loss shows ordered progress, ignores old steps and settles into a notice', async () => {
    await mount();
    const step = async (
      piece: SwitchPiece,
      state: SwitchStepState,
      label: string,
      switchId = CURRENT_SWITCH_ID,
    ) => {
      await act(() =>
        appEvents.emit('switchStep', { switchId, piece, state, label }),
      );
    };
    await step(
      SwitchPiece.voice,
      SwitchStepState.ready,
      'Voice: ElevenLabs',
      PREVIOUS_SWITCH_ID,
    );
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    expect(hasText('Connection lost. Switching to offline.')).toBe(true);
    await step(SwitchPiece.voice, SwitchStepState.starting, 'Voice: Kokoro');
    expect(renderer.root.findByType(ActivityIndicator).props.color).toBe(
      Color.muted,
    );
    await step(
      SwitchPiece.answers,
      SwitchStepState.starting,
      'Answers: on-device model',
    );
    expect(hasText('Voice: Kokoro')).toBe(true);
    expect(hasText('Answers: on-device model')).toBe(true);
    await step(
      SwitchPiece.listening,
      SwitchStepState.starting,
      'Listening: on device',
    );
    expect(hasText('Listening: on device')).toBe(true);
    await step(
      SwitchPiece.voice,
      SwitchStepState.fallback,
      'Voice: system voice',
    );
    await step(
      SwitchPiece.answers,
      SwitchStepState.ready,
      'Answers: on-device model',
    );
    await step(
      SwitchPiece.listening,
      SwitchStepState.ready,
      'Listening: on device',
    );
    await step(
      SwitchPiece.answers,
      SwitchStepState.ready,
      'Answers: Claude',
      PREVIOUS_SWITCH_ID,
    );
    const labels = renderer.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(labels).toEqual([
      'Connection lost. Switching to offline.',
      'Voice: system voice',
      'Answers: on-device model',
      'Listening: on device',
    ]);
    const fallback = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Voice: system voice')!;
    expect(StyleSheet.flatten(fallback.props.style).color).toBe(Color.caution);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    await mode({
      mode: InstructorMode.offline,
      answers: AnswerSource.deviceModel,
    });
    expect(hasText('Connection lost. Switching to offline.')).toBe(false);
    expect(hasText('Voice: system voice')).toBe(false);
    expect(hasText('Offline')).toBe(true);
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
    'shows the switch title for $mode caused by $cause',
    async ({ mode: nextMode, cause, title }) => {
      await mount();
      await act(() =>
        appEvents.emit('modeSuggestion', {
          mode: InstructorMode.offline,
          reason: 'weak signal',
        }),
      );
      await mode({ mode: nextMode, cause });
      expect(hasText(title)).toBe(true);
      expect(hasText('Weak signal')).toBe(false);
      const heading = renderer.root
        .findAllByType(Text)
        .find(node => node.props.children === title)!;
      expect(heading.props.accessibilityLiveRegion).toBe('polite');
    },
  );

  test('Reduce Motion removes entering and exiting animations from every mode banner', async () => {
    jest.mocked(useReducedMotion).mockReturnValue(true);
    await mount();
    const expectStill = () => {
      const banner =
        renderer.toJSON() as ReactTestRenderer.ReactTestRendererJSON;
      expect(banner.props.entering).toBeUndefined();
      expect(banner.props.exiting).toBeUndefined();
    };
    await mode({ mode: InstructorMode.offline, answers: AnswerSource.script });
    expectStill();
    await mode({});
    await act(() =>
      appEvents.emit('modeSuggestion', {
        mode: InstructorMode.offline,
        reason: 'weak signal',
      }),
    );
    expectStill();
    await mode({
      mode: InstructorMode.switchingToOffline,
      cause: ModeCause.network,
    });
    expectStill();
  });
});

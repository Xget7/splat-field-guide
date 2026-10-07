import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { appEvents } from '../apps/field-guide/src/features/events/bus';
import { useSwitchSteps } from '../apps/field-guide/src/features/events/useAppEvent';
import {
  AnswerSource,
  InstructorMode,
  ModeCause,
  SwitchPiece,
  SwitchStepState,
  VoiceSource,
  type ModeStatus,
} from '../apps/field-guide/src/features/events/types';

const ONLINE: ModeStatus = {
  mode: InstructorMode.online,
  cause: ModeCause.startup,
  voice: VoiceSource.agent,
  answers: AnswerSource.claude,
};
const SWITCH_ID = 1;

function SwitchProgress() {
  return (
    <>
      {useSwitchSteps().map(step => (
        <Text key={step.piece}>{step.label}</Text>
      ))}
    </>
  );
}

test('settled source updates preserve progress that arrives before the switching mode', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const progress = () =>
    renderer.root.findAllByType(Text).map(node => node.props.children);
  await act(() => {
    appEvents.emit('mode', ONLINE);
    renderer = ReactTestRenderer.create(<SwitchProgress />);
  });
  try {
    await act(() =>
      appEvents.emit('switchStep', {
        switchId: SWITCH_ID,
        piece: SwitchPiece.voice,
        state: SwitchStepState.starting,
        label: 'Voice: Kokoro',
      }),
    );
    expect(progress()).toEqual(['Voice: Kokoro']);
    await act(() =>
      appEvents.emit('mode', { ...ONLINE, voice: VoiceSource.device }),
    );
    expect(progress()).toEqual(['Voice: Kokoro']);
    await act(() =>
      appEvents.emit('mode', {
        ...ONLINE,
        mode: InstructorMode.switchingToOffline,
        cause: ModeCause.network,
      }),
    );
    expect(progress()).toEqual(['Voice: Kokoro']);
  } finally {
    await act(() => renderer.unmount());
  }
});

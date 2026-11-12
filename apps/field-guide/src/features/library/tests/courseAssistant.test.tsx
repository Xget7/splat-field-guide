import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  instructorStore,
  createExchangeIds,
  createTurnRunner,
} from '../../instructor';
import { catalogFor } from '../../pack/catalog';
import { fixturePack } from '@tests/fixturePack';
import { fakeInstructor } from '@tests/voiceSession';
import { CourseAssistant } from '../ui/CourseAssistant';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

test('a course question receives a grounded reply and opens its part only on request', async () => {
  const guide = catalogFor([fixturePack()])[0];
  const instructor = fakeInstructor({
    turns: createTurnRunner([], createExchangeIds()),
  });
  instructorStore.getState().attach(instructor);
  const open = jest.fn();
  let screen!: Renderer.ReactTestRenderer;
  await act(() => {
    screen = Renderer.create(
      <CourseAssistant
        guide={guide}
        question="Where is the battery?"
        onOpen={open}
        onDocument={jest.fn()}
      />,
    );
  });
  expect(
    screen.root.findByProps({ testID: 'course-answer' }).props
      .accessibilityLabel,
  ).toContain(guide.pack.parts.find(p => p.id === 'battery')!.summary);
  expect(open).not.toHaveBeenCalled();
  const action = screen.root
    .findAllByProps({ testID: 'course-answer-open' })
    .find(n => n.props.accessibilityRole === 'button')!;
  await act(() => action.props.onPress());
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      guideId: guide.id,
      mode: 'instructor',
      voice: false,
    }),
  );
  await act(() => screen.unmount());
});

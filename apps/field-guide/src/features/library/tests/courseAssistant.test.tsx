import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import {
  instructorStore,
  createExchangeIds,
  createTurnRunner,
} from '../../instructor';
import { catalogFor } from '../../pack/catalog';
import { fixturePack } from '@tests/fixturePack';
import { fakeInstructor, fakeVoiceSession } from '@tests/voiceSession';
import { CourseAssistant } from '../ui/CourseAssistant';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

test('a course location question receives a grounded reply and opens the exact part', async () => {
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
  expect(open).toHaveBeenCalledWith({
    guideId: guide.id,
    procedureId: null,
    stepIndex: 0,
    mode: 'instructor',
    voice: false,
    selectedPart: 'battery',
  });
  await act(() => screen.unmount());
});

test('an explicit repeated submission restarts a canceled question without asking again on a tab revisit', async () => {
  const guide = catalogFor([fixturePack()])[0];
  const respond = jest.fn(() => new Promise<string>(() => {}));
  const instructor = fakeInstructor({
    turns: createTurnRunner(
      [
        {
          isReady: () => true,
          prewarm: () => {},
          cancel: () => {},
          respond,
        },
      ],
      createExchangeIds(),
    ),
  });
  instructorStore.getState().attach(instructor);
  const props = {
    guide,
    question: 'Why does this step matter?',
    onOpen: jest.fn(),
    onDocument: jest.fn(),
  };
  let screen!: Renderer.ReactTestRenderer;
  await act(() => {
    screen = Renderer.create(
      <CourseAssistant {...props} requestId={1} active />,
    );
  });
  expect(respond).toHaveBeenCalledTimes(1);
  await act(() =>
    screen.update(<CourseAssistant {...props} requestId={1} active={false} />),
  );
  await act(() =>
    screen.update(<CourseAssistant {...props} requestId={1} active />),
  );
  expect(respond).toHaveBeenCalledTimes(1);
  await act(() =>
    screen.update(<CourseAssistant {...props} requestId={2} active />),
  );
  expect(respond).toHaveBeenCalledTimes(2);
  await act(() => screen.unmount());
});

test('an interrupted voice answer discards its pending scene navigation', async () => {
  const guide = catalogFor([fixturePack()])[0];
  const voice = fakeVoiceSession();
  instructorStore.getState().attach(
    fakeInstructor({
      sessionFor: () => ({
        session: voice.session,
        questions: voice.questions,
      }),
    }),
  );
  const open = jest.fn();
  let screen!: Renderer.ReactTestRenderer;
  await act(() => {
    screen = Renderer.create(
      <CourseAssistant
        guide={guide}
        question={null}
        onOpen={open}
        onDocument={jest.fn()}
      />,
    );
  });
  const mic = screen.root
    .findAllByProps({ testID: 'course-voice' })
    .find(node => node.props.accessibilityRole === 'button')!;
  await act(async () => {
    mic.props.onPress();
  });
  await act(() => {
    voice.questions.ask('Where is the battery?');
  });
  await act(() => {
    voice.events.action({ type: 'select', partId: 'battery' });
    voice.events.turn({
      type: 'answer',
      exchange: {
        id: 1,
        question: 'Where is the battery?',
        reply: 'Here...',
        caution: '',
        part: null,
        phase: 'done',
        interrupted: true,
      },
      answer: { reply: 'Here...', caution: '', part: null, event: null },
    });
  });
  expect(open).not.toHaveBeenCalled();
  expect(voice.context.state.selectedPart).toBeNull();
  await act(() => screen.unmount());
});

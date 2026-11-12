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
import { Text } from 'react-native';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));

test('a course location reply proposes the exact part and opens 3D only after an explicit tap', async () => {
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
  const navigate = screen.root.findAll(
    node =>
      node.props.accessibilityLabel === 'Navigate to 3D, Battery' &&
      node.props.accessibilityRole === 'button',
  )[0];
  expect(navigate).toBeDefined();
  await act(() => navigate.props.onPress());
  expect(open).toHaveBeenCalledWith({
    guideId: guide.id,
    procedureId: null,
    stepIndex: 0,
    mode: 'selfGuided',
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

test('the entire conversation and its cards survive inspection blur and return', async () => {
  const guide = catalogFor([fixturePack()])[0];
  instructorStore.getState().attach(fakeInstructor());
  const onOpen = jest.fn();
  const props = { guide, onOpen, onDocument: jest.fn() };
  let screen!: Renderer.ReactTestRenderer;
  await act(() => {
    screen = Renderer.create(
      <CourseAssistant
        {...props}
        requestId={1}
        question="Where is the battery?"
      />,
    );
  });
  await act(() =>
    screen.update(
      <CourseAssistant
        {...props}
        requestId={2}
        question="Where is the fuse box?"
      />,
    ),
  );
  const questions = () =>
    screen.root.findAllByType(Text).map(item => item.props.children);
  expect(questions()).toEqual(
    expect.arrayContaining(['Where is the battery?', 'Where is the fuse box?']),
  );
  const navigate = screen.root.findAll(
    node =>
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === 'Navigate to 3D, Battery',
  )[0];
  await act(() => navigate.props.onPress());
  expect(onOpen).toHaveBeenCalledTimes(1);
  await act(() =>
    screen.update(
      <CourseAssistant
        {...props}
        requestId={2}
        question="Where is the fuse box?"
        active={false}
      />,
    ),
  );
  await act(() =>
    screen.update(
      <CourseAssistant
        {...props}
        requestId={2}
        question="Where is the fuse box?"
        active
      />,
    ),
  );
  expect(questions()).toEqual(
    expect.arrayContaining(['Where is the battery?', 'Where is the fuse box?']),
  );
  expect(
    screen.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Navigate to 3D, Battery',
    ),
  ).toHaveLength(1);
  expect(onOpen).toHaveBeenCalledTimes(1);
  await act(() => screen.unmount());
});

test('completed multi-tool replies offer valid individual cards and one grouped 3D inspection', async () => {
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
    await mic.props.onPress();
  });
  await act(() => {
    voice.questions.ask('Show the battery and fuse box.');
  });
  await act(() => {
    voice.events.action({ type: 'select', partId: 'battery' });
    voice.events.action({ type: 'select', partId: 'unknown-part' });
    voice.events.action({ type: 'select', partId: 'battery' });
    voice.events.action({ type: 'select', partId: 'fuse-box' });
  });
  expect(
    screen.root.findAllByProps({
      accessibilityLabel: 'Navigate to 3D, Battery',
    }),
  ).toHaveLength(0);
  await act(() => {
    voice.events.turn({
      type: 'answer',
      exchange: {
        id: 1,
        question: 'Show the battery and fuse box.',
        reply: 'Here are both components.',
        caution: '',
        part: null,
        phase: 'done',
      },
      answer: {
        reply: 'Here are both components.',
        caution: '',
        part: null,
        event: null,
      },
    });
  });
  expect(open).not.toHaveBeenCalled();
  expect(
    screen.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Navigate to 3D, Battery',
    ),
  ).toHaveLength(1);
  expect(
    screen.root.findAllByProps({
      accessibilityLabel: 'Navigate to 3D, unknown-part',
    }),
  ).toHaveLength(0);
  const group = screen.root
    .findAllByProps({ testID: 'course-navigate-group-1' })
    .find(node => node.props.accessibilityRole === 'button')!;
  await act(() => group.props.onPress());
  expect(open).toHaveBeenCalledWith({
    guideId: guide.id,
    procedureId: null,
    stepIndex: 0,
    mode: 'selfGuided',
    voice: false,
    selectedParts: ['battery', 'fuse-box'],
  });
  await act(() => screen.unmount());
});

test('stopping an unfinished answer removes its proposals and rejects late completion', async () => {
  const guide = catalogFor([fixturePack()])[0];
  let resolve!: (reply: string) => void;
  const instructor = fakeInstructor({
    turns: createTurnRunner(
      [
        {
          isReady: () => true,
          prewarm() {},
          cancel() {},
          respond: () =>
            new Promise<string>(done => {
              resolve = done;
            }),
        },
      ],
      createExchangeIds(),
    ),
  });
  instructorStore.getState().attach(instructor);
  const open = jest.fn();
  let screen!: Renderer.ReactTestRenderer;
  await act(() => {
    screen = Renderer.create(
      <CourseAssistant
        guide={guide}
        question="Explain why the battery matters."
        onOpen={open}
        onDocument={jest.fn()}
      />,
    );
  });
  const stop = screen.root
    .findAllByProps({ testID: 'course-chat-stop' })
    .find(node => node.props.accessibilityRole === 'button')!;
  await act(() => stop.props.onPress());
  await act(() => resolve('The battery supplies electrical power.'));
  expect(
    screen.root.findAllByType(Text).map(item => item.props.children),
  ).toContain('Answer interrupted');
  expect(
    screen.root.findAllByProps({
      accessibilityLabel: 'Navigate to 3D, Battery',
    }),
  ).toHaveLength(0);
  expect(open).not.toHaveBeenCalled();
  await act(() => screen.unmount());
});

test('typed course answers retain proposal context and expand a complete component group into cards', async () => {
  const guide = catalogFor([fixturePack()])[0];
  const respond = jest.fn(async () => ({
    reply: 'Here are both components.',
    caution: '',
    part: null,
    event: { type: 'selectParts' as const, partIds: ['battery', 'fuse-box'] },
  }));
  instructorStore.getState().attach(
    fakeInstructor({
      turns: createTurnRunner(
        [
          {
            courseKnowledge: true,
            isReady: () => true,
            prewarm() {},
            cancel() {},
            respond,
          },
        ],
        createExchangeIds(),
      ),
    }),
  );
  const open = jest.fn();
  let screen!: Renderer.ReactTestRenderer;
  await act(async () => {
    screen = Renderer.create(
      <CourseAssistant
        guide={guide}
        question="Show the battery and fuse box."
        onOpen={open}
        onDocument={jest.fn()}
      />,
    );
  });
  expect(respond).toHaveBeenCalledWith(
    expect.objectContaining({ navigation: 'proposal' }),
    expect.any(Function),
  );
  expect(open).not.toHaveBeenCalled();
  for (const name of ['Battery', 'Fuse box']) {
    expect(
      screen.root.findAll(
        node =>
          typeof node.type === 'string' &&
          node.props.accessibilityRole === 'button' &&
          node.props.accessibilityLabel === `Navigate to 3D, ${name}`,
      ),
    ).toHaveLength(1);
  }
  await act(() => screen.unmount());
});

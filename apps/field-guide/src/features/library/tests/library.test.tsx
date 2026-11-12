import React from 'react';
import { Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { catalogFor, type ReadyGuide } from '../../pack/catalog';
import { fakeStorage } from '@tests/platform';
import {
  createProgressStorage,
  LearnMode,
  type ProgressStorage,
} from '../../guide';
import { fixturePack } from '@tests/fixturePack';
import { fakeInstructor } from '@tests/voiceSession';
import { instructorStore } from '../../instructor';
import type { CourseDocuments } from '../../../platform/documents';

import { continueRowFor, factsFor } from '../domain/library';
import { LibraryScreen } from '../ui/LibraryScreen';

jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));

const pack = fixturePack();
const catalog = catalogFor([pack]);
const guide = catalog[0] as ReadyGuide;
const progress = {
  guideId: pack.packId,
  procedureId: 'check-coolant',
  stepIndex: 1,
} as const;

test.each([
  null,
  { ...progress, guideId: 'unknown' },
  { ...progress, guideId: 'tactical-truck-engine-bay' },
  { ...progress, procedureId: 'unknown' },
  { ...progress, stepIndex: -1 },
  { ...progress, stepIndex: 1.5 },
  { ...progress, stepIndex: 5 },
])('invalid or stale progress has no continue row: %j', saved => {
  expect(continueRowFor(catalog, saved)).toBeNull();
});

test('an empty catalog cannot resume a previously saved guide', () => {
  expect(continueRowFor([], progress)).toBeNull();
});

test('continue shows one-based progress and a fraction of the procedure', () => {
  expect(continueRowFor(catalog, progress)).toMatchObject({
    guide: catalog[0],
    procedure: pack.procedures[1],
    stepIndex: 1,
    stepLabel: 'Step 2 of 3',
    fraction: 2 / 3,
  });
});

test('a guide counts its parts and authored procedures, leaving out the tour', () => {
  const authored = pack.procedures.length - 1;
  expect(pack.procedures[0].id).toBe('tour');
  expect(factsFor(guide)).toEqual([
    `${pack.parts.length} parts`,
    `${authored} procedures`,
  ]);
});

describe('Library screen', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const listeners = new Map<string, () => void>();
  // Only the focus events reach the screen; it opens everything through its callbacks.
  const navigation = {
    isFocused: () => true,
    addListener: jest.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return () => {
        listeners.delete(event);
      };
    }),
  };
  const onOpenGuide = jest.fn();
  const onOpen = jest.fn();
  let device: ReturnType<typeof fakeStorage>;
  let storage: ProgressStorage;
  const saveProgress = (saved: Parameters<ProgressStorage['save']>[0]) =>
    storage.save(saved);
  const node = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(item => item.props.accessibilityRole === 'button') ??
    renderer.root.findByProps({ testID });
  const press = async (testID: string) => {
    await act(async () => {
      await node(testID).props.onPress();
    });
  };
  const mount = async (documents?: CourseDocuments) => {
    await act(() => {
      renderer = ReactTestRenderer.create(
        <NavigationContext.Provider
          value={
            navigation as unknown as React.ContextType<typeof NavigationContext>
          }
        >
          <LibraryScreen
            catalog={catalog}
            documents={documents}
            progress={storage}
            onOpenGuide={onOpenGuide}
            onOpen={onOpen}
          />
        </NavigationContext.Provider>,
      );
    });
  };
  beforeEach(() => {
    jest.clearAllMocks();
    instructorStore.getState().attach(fakeInstructor());
    device = fakeStorage();
    storage = createProgressStorage(device.storage);
  });
  afterEach(async () => {
    if (renderer) {
      await act(() => renderer.unmount());
    }
  });

  test('the library offers only the available guide', async () => {
    await mount();
    await press(`guide-card-${pack.packId}`);
    expect(onOpenGuide).toHaveBeenCalledWith(guide);
    const cardIds = new Set(
      renderer.root
        .findAll(item => item.props.testID?.startsWith('guide-card-'))
        .map(item => item.props.testID),
    );
    expect([...cardIds]).toEqual([`guide-card-${pack.packId}`]);
    expect(
      renderer.root.findAll(item =>
        item.props.testID?.startsWith('soon-card-'),
      ),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
  });

  test('sidebar routes to modules and documentation, opens equipment and keeps Assistant in the course', async () => {
    await mount();
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Miris' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'navigation-assistant' }),
    ).toHaveLength(0);
    await press('navigation-modules');
    expect(node('navigation-modules').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(
      renderer.root.findAllByProps({ testID: 'course-explore' }),
    ).toHaveLength(0);
    await press('navigation-documentation');
    expect(node('navigation-documentation').props.accessibilityState).toEqual({
      selected: true,
    });
    await press('navigation-equipment');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: pack.procedures[0].id,
      stepIndex: 0,
      mode: LearnMode.selfGuided,
    });
    await press('navigation-courses');
    expect(node('course-explore')).toBeDefined();
  });

  test('modules start real authored procedures with their full qualified titles', async () => {
    await mount();
    await press('navigation-modules');
    const texts = renderer.root
      .findAllByType(Text)
      .map(item => item.props.children);
    expect(texts).not.toContain('Body Transport');
    expect(texts).not.toContain('Cell Safety');
    for (const procedure of pack.procedures.slice(1)) {
      expect(texts).toContain(procedure.title);
      await press(`module-procedure-${pack.packId}-${procedure.id}`);
      expect(onOpen).toHaveBeenLastCalledWith({
        guideId: pack.packId,
        procedureId: procedure.id,
        stepIndex: 0,
        mode: LearnMode.selfGuided,
      });
    }
  });

  test('Help offers an actionable equipment entry alongside gesture guidance', async () => {
    await mount();
    await press('navigation-help');
    await press('help-equipment');
    expect(onOpen).toHaveBeenLastCalledWith({
      guideId: pack.packId,
      procedureId: pack.procedures[0].id,
      stepIndex: 0,
      mode: LearnMode.selfGuided,
    });
  });

  test('sidebar resume uses validated saved continuation only', async () => {
    await saveProgress(progress);
    await mount();
    await press('navigation-resume');
    expect(onOpen).toHaveBeenLastCalledWith({
      ...progress,
      mode: LearnMode.selfGuided,
    });
  });

  test('the source attachment opens the local manual and keeps Documentation selected', async () => {
    const documents = {
      list: jest.fn(async () => []),
      open: jest.fn(async () => {}),
    };
    await mount(documents);
    const attachment = renderer.root
      .findAllByProps({
        accessibilityLabel: 'Open source document, KR QUANTEC extra.pdf',
      })
      .find(item => typeof item.props.onPress === 'function')!;
    await act(async () => {
      await attachment.props.onPress();
    });
    expect(documents.open).toHaveBeenCalledWith('kuka-quantec-extra-v4');
    expect(node('navigation-documentation').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  test('course questions open the grounded course assistant', async () => {
    await mount();
    const input = renderer.root
      .findAllByProps({ testID: 'course-question' })
      .find(item => typeof item.props.onChangeText === 'function')!;
    expect(node('course-send').props.disabled).toBe(true);
    await act(() => input.props.onChangeText('Where is the A5 axis motor?'));
    await press('course-send');
    const texts = renderer.root
      .findAllByType(Text)
      .map(item => item.props.children);
    expect(texts).toContain('Where is the A5 axis motor?');
    expect(texts).toContain('Course assistant');
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('explore opens the available tour directly in 3D', async () => {
    await mount();
    await press('course-explore');
    expect(onOpen).toHaveBeenCalledWith({
      guideId: pack.packId,
      procedureId: pack.procedures[0].id,
      stepIndex: 0,
      mode: LearnMode.selfGuided,
    });
    expect(onOpenGuide).not.toHaveBeenCalled();
  });

  test('source navigation preserves the submitted question and unfinished draft', async () => {
    await mount();
    const input = () =>
      renderer.root
        .findAllByProps({ testID: 'course-question' })
        .find(item => typeof item.props.onChangeText === 'function')!;
    const pressLabel = async (accessibilityLabel: string) => {
      const control = renderer.root
        .findAllByProps({ accessibilityLabel })
        .find(item => typeof item.props.onPress === 'function')!;
      await act(async () => {
        await control.props.onPress();
      });
    };
    await act(() => input().props.onChangeText('Where is the A5 axis motor?'));
    await press('course-send');
    await act(() => input().props.onChangeText('What does it drive?'));
    await pressLabel('Open source document, KR QUANTEC extra.pdf');
    await pressLabel('Assistant');
    expect(input().props.value).toBe('What does it drive?');
    expect(
      renderer.root.findAllByType(Text).map(item => item.props.children),
    ).toContain('Where is the A5 axis motor?');
  });

  test('the discarded spatial assembly entry is absent', async () => {
    await mount();
    expect(
      renderer.root.findAllByProps({ testID: 'open-ar-assembly' }),
    ).toHaveLength(0);
  });

  test('course offline availability is distinct from an available scene', async () => {
    await mount();
    const downloads = renderer.root
      .findAllByProps({
        accessibilityLabel: 'Course downloads',
      })
      .find(item => typeof item.props.onPress === 'function')!;
    await act(() => downloads.props.onPress());
    const texts = renderer.root
      .findAllByType(Text)
      .map(item => item.props.children);
    expect(texts).toContain('Local demo resources');
    expect(texts).toContain('3D scene');
    expect(texts).toContain('Available');
    expect(texts).toContain('Equipment manuals');
    expect(texts).toContain('Course activities');
    expect(texts).toContain('Not downloaded');
    expect(texts).not.toContain('Offline ready');
  });

  test('global Downloads and Help do not inherit course navigation', async () => {
    await mount();
    const select = async (label: string) => {
      const control = renderer.root
        .findAllByProps({ accessibilityLabel: label })
        .find(item => typeof item.props.onPress === 'function')!;
      await act(async () => {
        await control.props.onPress();
      });
    };
    for (const destination of ['Downloads', 'Help']) {
      await select(destination);
      expect(
        renderer.root.findAllByProps({ accessibilityRole: 'tablist' }),
      ).toHaveLength(0);
      expect(
        renderer.root.findAllByProps({ testID: 'course-breadcrumb' }),
      ).toHaveLength(0);
    }
    await press('navigation-courses');
    expect(
      renderer.root.findAllByProps({ accessibilityRole: 'tablist' }).length,
    ).toBeGreaterThan(0);
    expect(
      renderer.root.findAllByProps({ testID: 'course-breadcrumb' }).length,
    ).toBeGreaterThan(0);
  });

  test('saved progress opens the same step from the row and its play button', async () => {
    await saveProgress(progress);
    await mount();
    await press('library-continue');
    await act(() =>
      node('library-continue')
        .findAll(
          item =>
            item.props.accessibilityRole === 'button' &&
            typeof item.props.onPress === 'function',
        )
        .at(-1)!
        .props.onPress(),
    );
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith({
      ...progress,
      mode: LearnMode.selfGuided,
    });
  });

  test('focus re-reads progress and removes a stale record', async () => {
    await mount();
    await act(() => listeners.get('blur')?.());
    await saveProgress(progress);
    await act(() => listeners.get('focus')?.());
    expect(node('library-continue')).toBeDefined();
    await act(() => listeners.get('blur')?.());
    await saveProgress({ ...progress, procedureId: 'removed' });
    await act(() => listeners.get('focus')?.());
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
  });

  test('a storage read from the previous focus cannot replace newer progress', async () => {
    let resolve!: (saved: string | null) => void;
    device.storage.getItem.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    await mount();
    await act(() => listeners.get('blur')?.());
    const newer = { ...progress, stepIndex: 2 };
    await saveProgress(newer);
    await act(() => listeners.get('focus')?.());
    await act(() => resolve(JSON.stringify(progress)));
    await press('library-continue');
    expect(onOpen).toHaveBeenLastCalledWith({
      ...newer,
      mode: LearnMode.selfGuided,
    });
  });

  test('storage failure leaves the library usable', async () => {
    device.storage.getItem.mockRejectedValueOnce(new Error('unavailable'));
    await mount();
    expect(
      renderer.root.findAllByProps({ testID: 'library-continue' }),
    ).toHaveLength(0);
    await press(`guide-card-${pack.packId}`);
    expect(onOpenGuide).toHaveBeenCalledWith(guide);
  });
});

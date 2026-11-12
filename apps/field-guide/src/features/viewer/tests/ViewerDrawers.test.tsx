import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { fixturePack } from '@tests/fixturePack';
import { CardKind } from '../../guide';
import { Capability } from '../domain/capability';
import { ViewerRail } from '../ui/shell/ViewerRail';
import { ActivityPanel } from '../ui/shell/ActivityPanel';
import { ExploreDrawer } from '../ui/shell/ExploreDrawer';
import { CautionNote } from '../../../ui/CautionNote';

const steps = [
  {
    id: 'cold',
    text: 'Switch the engine off.',
    detail: 'Wait for the engine to cool.',
    caution: 'Only open the cap with the engine cold.',
  },
  { id: 'locate', text: 'Find the tank.', detail: '', caution: '' },
  { id: 'read', text: 'Read the level.', detail: '', caution: '' },
];
const content = {
  kind: CardKind.procedure,
  title: 'Coolant reservoir',
  body: steps[0].text,
  caution: steps[0].caution,
  stepNumber: 1,
  stepCount: steps.length,
  selected: false,
  backDisabled: true,
  nextDisabled: false,
  last: false,
};

describe('viewer rail and drawers', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const button = (testID: string) =>
    renderer.root
      .findAllByProps({ testID })
      .find(node => node.props.accessibilityRole === 'button')!;
  const has = (testID: string) =>
    renderer.root.findAllByProps({ testID }).length > 0;
  const press = async (testID: string) => {
    const control = button(testID);
    if (!control.props.disabled) {
      await act(() => control.props.onPress());
    }
  };
  const mount = async (element: React.ReactElement) => {
    await act(() => {
      renderer = ReactTestRenderer.create(element);
    });
  };

  afterEach(async () => {
    await act(() => renderer?.unmount());
    jest.mocked(useReducedMotion).mockReturnValue(false);
  });

  test('rail reports the capability and only marks an open panel selected', async () => {
    const props = {
      topInset: 20,
      bottomInset: 34,
      capability: Capability.guide,
      drawerOpen: true,
      onBack: jest.fn(),
      onCapability: jest.fn(),
    };
    await mount(<ViewerRail {...props} />);
    expect(button('viewer-rail-back').props.accessibilityLabel).toBe(
      'Back to guides',
    );
    expect(button('viewer-rail-guide').props.accessibilityState).toEqual({
      selected: true,
    });
    await press('viewer-rail-guide');
    await press('viewer-rail-explore');
    await press('viewer-rail-back');
    expect(props.onCapability.mock.calls).toEqual([
      [Capability.guide],
      [Capability.explore],
    ]);
    expect(props.onBack).toHaveBeenCalledTimes(1);
    await act(() =>
      renderer.update(<ViewerRail {...props} drawerOpen={false} />),
    );
    for (const id of ['viewer-rail-guide', 'viewer-rail-explore']) {
      expect(button(id).props.accessibilityState).toEqual({ selected: false });
    }
  });

  test('activity presents only the current instruction and explicit navigation', async () => {
    const props = {
      procedureTitle: 'Check the coolant level',
      content,
      detail: steps[0].detail,
      onBack: jest.fn(),
      onNext: jest.fn(),
      onClose: jest.fn(),
    };
    await mount(<ActivityPanel {...props} />);
    expect(has('step-list')).toBe(false);
    expect(has('procedure-button')).toBe(false);
    expect(has('guidance-instructor')).toBe(false);
    expect(renderer.root.findAllByType(CautionNote)).toHaveLength(1);
    const text = renderer.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(text).toContain('Check the coolant level');
    expect(text).toContain('Coolant reservoir');
    expect(text).toContain(steps[0].text);
    expect(text).toContain(steps[0].detail);
    expect(text).toContain('Step 1 of 3');
    expect(text).not.toContain(steps[1].text);
    await press('step-back');
    await press('step-next');
    await press('activity-close');
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await act(() =>
      renderer.update(
        <ActivityPanel
          {...props}
          content={{
            ...content,
            stepNumber: 3,
            backDisabled: false,
            last: true,
            caution: '',
          }}
        />,
      ),
    );
    expect(button('step-next').props.accessibilityLabel).toBe('Finish');
    expect(has('caution')).toBe(false);
    await press('step-back');
    expect(props.onBack).toHaveBeenCalledTimes(1);
    await act(() =>
      renderer.update(
        <ActivityPanel
          {...props}
          content={{ ...content, nextDisabled: true }}
        />,
      ),
    );
    await press('step-next');
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  test('search keeps identically named components attached to their machines', async () => {
    const reference = fixturePack().parts[0];
    const parts = [
      { ...reference, id: 'roof', name: 'Roof welder', parent: null },
      { ...reference, id: 'rear', name: 'Rear-body welder', parent: null },
      { ...reference, id: 'roof-base', name: 'Base', parent: 'roof' },
      { ...reference, id: 'rear-base', name: 'Base', parent: 'rear' },
    ];
    await mount(
      <ExploreDrawer
        topInset={20}
        bottomInset={34}
        parts={parts}
        selected={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    await act(() =>
      renderer.root
        .findByProps({ testID: 'part-search' })
        .props.onChangeText('base'),
    );
    expect(button('part-row-roof-base').props.accessibilityLabel).toBe(
      'Roof welder: Base',
    );
    expect(button('part-row-rear-base').props.accessibilityLabel).toBe(
      'Rear-body welder: Base',
    );
    expect(
      button('part-row-roof-base')
        .findAllByType(Text)
        .map(node => node.props.children),
    ).toContain('Roof welder');
    await act(() =>
      renderer.root
        .findByProps({ testID: 'part-search' })
        .props.onChangeText('roof base'),
    );
    expect(has('part-row-roof-base')).toBe(true);
    expect(has('part-row-rear-base')).toBe(false);
  });

  test('Explore reveals the selected branch and searches hidden descendants by alias', async () => {
    const pack = fixturePack();
    const valve = pack.parts.find(part => part.id === 'valve-cover')!;
    const cap = {
      ...valve,
      id: 'oil-cap',
      name: 'Oil cap',
      aliases: ['filler lid'],
      parent: valve.id,
    };
    const props = {
      topInset: 20,
      bottomInset: 34,
      parts: [...pack.parts, cap],
      selected: cap.id,
      onSelect: jest.fn(),
      onClose: jest.fn(),
    };
    await mount(<ExploreDrawer {...props} />);
    expect(has('part-row-oil-cap')).toBe(true);
    expect(button('part-expand-engine').props.accessibilityState).toEqual({
      expanded: true,
    });
    expect(button('part-expand-valve-cover').props.accessibilityState).toEqual({
      expanded: true,
    });
    expect(has('part-expand-battery')).toBe(false);
    await press('part-expand-engine');
    expect(has('part-row-oil-cap')).toBe(false);
    expect(props.onSelect).not.toHaveBeenCalled();
    await act(() =>
      renderer.root
        .findByProps({ testID: 'part-search' })
        .props.onChangeText('  FILLER LID  '),
    );
    expect(has('part-row-oil-cap')).toBe(true);
    expect(has('part-row-engine')).toBe(false);
    expect(has('part-expand-valve-cover')).toBe(false);
    await press('part-row-oil-cap');
    expect(props.onSelect).toHaveBeenCalledWith(cap.id);
    await act(() =>
      renderer.root
        .findByProps({ testID: 'part-search' })
        .props.onChangeText('no matching part'),
    );
    expect(
      renderer.root.findAllByType(Text).map(node => node.props.children),
    ).toContain('No parts match');
    await act(() =>
      renderer.root
        .findByProps({ testID: 'part-search' })
        .props.onChangeText('battery'),
    );
    expect(has('part-row-battery')).toBe(true);
    await act(() =>
      renderer.root
        .findByProps({ testID: 'part-search' })
        .props.onChangeText(''),
    );
    expect(has('part-row-engine')).toBe(true);
    expect(has('part-row-oil-cap')).toBe(false);
    await act(() =>
      renderer.update(<ExploreDrawer {...props} selected="intake-manifold" />),
    );
    expect(has('part-row-intake-manifold')).toBe(true);
    expect(button('part-row-intake-manifold').props.accessibilityState).toEqual(
      {
        selected: true,
      },
    );
    await press('drawer-close');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

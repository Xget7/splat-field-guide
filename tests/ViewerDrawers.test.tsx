import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ScrollView, Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { fixturePack } from './fixturePack';
import { CardKind } from '../apps/field-guide/src/screens/viewer/guideContent';
import { Capability } from '../apps/field-guide/src/screens/viewer/shell/layout';
import { ViewerRail } from '../apps/field-guide/src/screens/viewer/shell/ViewerRail';
import { GuideDrawer } from '../apps/field-guide/src/screens/viewer/shell/GuideDrawer';
import { ExploreDrawer } from '../apps/field-guide/src/screens/viewer/shell/ExploreDrawer';
import { CautionNote } from '../apps/field-guide/src/screens/viewer/instructor/CautionNote';

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

  test('Guide owns the full current instruction, navigation and scrolling', async () => {
    const props = {
      topInset: 20,
      bottomInset: 34,
      procedureTitle: 'Check the coolant level',
      onChooseProcedure: jest.fn(),
      steps,
      current: 0,
      onGoTo: jest.fn(),
      content,
      onBack: jest.fn(),
      onNext: jest.fn(),
      onClose: jest.fn(),
    };
    await mount(<GuideDrawer {...props} />);
    expect(button('step-row-0').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(button('step-row-0').findAllByProps({ testID: 'caution' })).toEqual(
      [],
    );
    expect(renderer.root.findAllByType(CautionNote)).toHaveLength(1);
    expect(
      renderer.root.findByProps({ testID: 'step-current-detail' }).props
        .children,
    ).toBe(steps[0].detail);
    expect(
      renderer.root
        .findAllByType(Text)
        .filter(node => node.props.children === steps[0].text),
    ).toHaveLength(1);
    await press('procedure-button');
    await press('step-row-2');
    await press('step-back');
    await press('step-next');
    await press('drawer-close');
    expect(props.onChooseProcedure).toHaveBeenCalledTimes(1);
    expect(props.onGoTo).toHaveBeenCalledWith(2);
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    const scroll = renderer.root
      .findByProps({ testID: 'step-list' })
      .findByType(ScrollView);
    const scrollTo = jest.mocked(scroll.instance.scrollTo);
    const layout = (y: number, height: number) => ({
      nativeEvent: { layout: { x: 0, y, width: 288, height } },
    });
    await act(() => {
      scroll.props.onLayout(layout(0, 160));
      renderer.root
        .findByProps({ testID: 'step-group-0' })
        .props.onLayout(layout(0, 110));
      renderer.root
        .findByProps({ testID: 'step-group-2' })
        .props.onLayout(layout(166, 48));
    });
    scrollTo.mockClear();
    jest.mocked(useReducedMotion).mockReturnValue(true);
    await act(() =>
      renderer.update(
        <GuideDrawer
          {...props}
          current={2}
          content={{ ...content, backDisabled: false, last: true }}
        />,
      ),
    );
    expect(scrollTo).toHaveBeenCalledWith({ y: 54, animated: false });
    expect(button('step-next').props.accessibilityLabel).toBe('Finish');
    expect(button('step-row-0').props.accessibilityLabel).toContain(
      'earlier step',
    );
    expect(has('caution')).toBe(false);
    await press('step-back');
    expect(props.onBack).toHaveBeenCalledTimes(1);
    await act(() =>
      renderer.update(
        <GuideDrawer {...props} content={{ ...content, nextDisabled: true }} />,
      ),
    );
    expect(button('step-next').props.accessibilityState).toEqual({
      disabled: true,
    });
    await press('step-next');
    expect(props.onNext).toHaveBeenCalledTimes(1);
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

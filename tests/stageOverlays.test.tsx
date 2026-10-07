import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, View } from 'react-native';
import { Breadcrumb } from '../apps/field-guide/src/screens/viewer/stage/Breadcrumb';
import { PartCard } from '../apps/field-guide/src/screens/viewer/stage/PartCard';
import { ToolDock } from '../apps/field-guide/src/screens/viewer/stage/ToolDock';
import { fixturePack } from './fixturePack';

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: jest.fn(config => ({ kind: 'pan', config })),
}));

const AREA = 'Engine bay';
const PARTS = fixturePack().parts;
const STAGE = { width: 900, height: 700 };
const CLEAR = { top: 100, right: 24, bottom: 100, left: 24 };

describe('stage overlays', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const buttons = () =>
    renderer.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function',
    );
  const button = (label: string) =>
    buttons().find(node => node.props.accessibilityLabel === label)!;
  const text = () =>
    renderer.root.findAllByType(Text).map(node => node.props.children);

  afterEach(async () => {
    await act(() => renderer?.unmount());
  });

  test('ancestor crumbs navigate and the current crumb stays a heading', async () => {
    const onArea = jest.fn();
    const onPart = jest.fn();
    await act(() => {
      renderer = ReactTestRenderer.create(
        <Breadcrumb
          area={AREA}
          trail={[PARTS[5], PARTS[6]]}
          onArea={onArea}
          onPart={onPart}
        />,
      );
    });
    expect(
      renderer.root.findByProps({ accessibilityRole: 'header' }).props
        .accessibilityLabel,
    ).toBe(`${AREA}, ${PARTS[5].name}, ${PARTS[6].name}`);
    await act(() => button(AREA).props.onPress());
    await act(() => button(PARTS[5].name).props.onPress());
    expect(onArea).toHaveBeenCalledTimes(1);
    expect(onPart).toHaveBeenCalledWith(PARTS[5].id);
    expect(button(PARTS[6].name)).toBeUndefined();

    await act(() =>
      renderer.update(
        <Breadcrumb area={AREA} trail={[]} onArea={onArea} onPart={onPart} />,
      ),
    );
    expect(buttons()).toHaveLength(0);
    expect(
      renderer.root.findByProps({ accessibilityRole: 'header' }).props
        .accessibilityLabel,
    ).toBe(AREA);
  });

  test('folding hides the summary and remains folded when the selected part changes', async () => {
    const card = (part: (typeof PARTS)[number] | null) => (
      <PartCard part={part} stage={STAGE} clear={CLEAR} />
    );
    await act(() => {
      renderer = ReactTestRenderer.create(card(PARTS[0]));
    });
    expect(text()).toContain(PARTS[0].summary);
    expect(button('Fold part card').props.accessibilityState).toEqual({
      expanded: true,
    });
    await act(() => button('Fold part card').props.onPress());
    expect(text()).not.toContain(PARTS[0].summary);
    expect(button('Expand part card').props.accessibilityState).toEqual({
      expanded: false,
    });
    await act(() => renderer.update(card(PARTS[3])));
    expect(text()).toContain(PARTS[3].name);
    expect(text()).not.toContain(PARTS[3].summary);
    await act(() => button('Expand part card').props.onPress());
    expect(text()).toContain(PARTS[3].summary);
    await act(() => renderer.update(card(null)));
    expect(renderer.toJSON()).toBeNull();
  });

  test('dock actions use controlled toggles, disable repeat and dismiss help', async () => {
    const onRecenter = jest.fn();
    const onToggleLabels = jest.fn();
    const onRepeat = jest.fn();
    const onToggleFullView = jest.fn();
    const dock = (enabled: boolean) => (
      <ToolDock
        labelsOn={enabled}
        fullView={enabled}
        canRepeat={enabled}
        onRecenter={onRecenter}
        onToggleLabels={onToggleLabels}
        onRepeat={onRepeat}
        onToggleFullView={onToggleFullView}
      />
    );
    await act(() => {
      renderer = ReactTestRenderer.create(dock(false));
    });
    expect(buttons().map(node => node.props.accessibilityLabel)).toEqual([
      'Recenter view',
      'Part labels',
      'Repeat step',
      'Help',
      'Full view',
    ]);
    expect(button('Repeat step').props.disabled).toBe(true);
    expect(button('Repeat step').props.accessibilityState.disabled).toBe(true);
    await act(() => button('Recenter view').props.onPress());
    await act(() => button('Part labels').props.onPress());
    await act(() => button('Full view').props.onPress());
    expect(onRecenter).toHaveBeenCalledTimes(1);
    expect(onToggleLabels).toHaveBeenCalledTimes(1);
    expect(onToggleFullView).toHaveBeenCalledTimes(1);
    expect(button('Part labels').props.accessibilityState.selected).toBe(false);

    await act(() => renderer.update(dock(true)));
    expect(button('Part labels').props.accessibilityState.selected).toBe(true);
    expect(button('Full view').props.accessibilityState.selected).toBe(true);
    await act(() => button('Repeat step').props.onPress());
    expect(onRepeat).toHaveBeenCalledTimes(1);

    const measuredDock = renderer.root
      .findAllByType(View)
      .find(node => node.props.testID === 'stage-tool-dock')!;
    jest
      .mocked(measuredDock.instance.measureInWindow)
      .mockImplementation(
        (
          callback: (
            x: number,
            y: number,
            width: number,
            height: number,
          ) => void,
        ) => callback(100, 600, 288, 48),
      );
    await act(() => button('Help').props.onPress());
    expect(button('Help').props.accessibilityState.expanded).toBe(true);
    expect(text()).toEqual(
      expect.arrayContaining([
        'Drag to turn the model.',
        'Pinch to zoom.',
        'Tap a part to select it.',
      ]),
    );
    await act(() => button('Help').props.onPress());
    expect(button('Help').props.accessibilityState.expanded).toBe(false);
    await act(() => button('Help').props.onPress());
    await act(() => button('Dismiss help').props.onPress());
    expect(button('Help').props.accessibilityState.expanded).toBe(false);
    expect(text()).not.toContain('Pinch to zoom.');
  });
});

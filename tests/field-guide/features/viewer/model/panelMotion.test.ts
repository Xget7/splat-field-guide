import {
  panelAfterDrag,
  PanelMode,
  PanelPan,
  panelOffset,
  togglePanel,
} from '../../../../../apps/field-guide/src/features/viewer/model/panelMotion';

test('the grabber and header toggle between the two panel modes', () => {
  expect(togglePanel(PanelMode.expanded)).toBe(PanelMode.minimized);
  expect(togglePanel(PanelMode.minimized)).toBe(PanelMode.expanded);
});

test.each([PanelMode.expanded, PanelMode.minimized])(
  'distance and velocity determine the snap from %s',
  mode => {
    expect(panelAfterDrag(mode, PanelPan.distance, 0, false)).toBe(
      PanelMode.minimized,
    );
    expect(panelAfterDrag(mode, -PanelPan.distance, 0, false)).toBe(
      PanelMode.expanded,
    );
    expect(panelAfterDrag(mode, 0, PanelPan.velocity, false)).toBe(
      PanelMode.minimized,
    );
    expect(panelAfterDrag(mode, 0, -PanelPan.velocity, false)).toBe(
      PanelMode.expanded,
    );
    expect(panelAfterDrag(mode, 10, 0, false)).toBe(mode);
    expect(panelAfterDrag(mode, 100, 600, true)).toBe(mode);
  },
);

test('a fling wins over distance when the direction reverses', () => {
  expect(panelAfterDrag(PanelMode.expanded, 100, -600, false)).toBe(
    PanelMode.expanded,
  );
  expect(panelAfterDrag(PanelMode.minimized, -100, 600, false)).toBe(
    PanelMode.minimized,
  );
});

test('malformed pan values keep the mode and offset stable', () => {
  expect(panelAfterDrag(PanelMode.expanded, NaN, 0, false)).toBe(
    PanelMode.expanded,
  );
  expect(panelAfterDrag(PanelMode.minimized, 0, Infinity, false)).toBe(
    PanelMode.minimized,
  );
  expect(panelOffset(PanelMode.expanded, NaN, 240)).toBe(0);
  expect(panelOffset(PanelMode.minimized, 10, 0)).toBe(0);
});

test('the panel follows the finger in its range and resists past both ends', () => {
  expect(panelOffset(PanelMode.expanded, 100, 240)).toBe(100);
  expect(panelOffset(PanelMode.expanded, -100, 240)).toBe(-20);
  expect(panelOffset(PanelMode.expanded, 340, 240)).toBe(260);
  expect(panelOffset(PanelMode.minimized, -100, 240)).toBe(-100);
  expect(panelOffset(PanelMode.minimized, 100, 240)).toBe(20);
  expect(panelOffset(PanelMode.minimized, -340, 240)).toBe(-260);
});

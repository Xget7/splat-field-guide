import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import App from '../apps/field-guide/src/App';
import { bundledPack } from '../apps/field-guide/src/features/pack/bundledPack';

jest.mock('react-native-splat', () => ({
  SplatView: 'SplatView',
  ModelView: 'ModelView',
}));
jest.mock('react-native-nitro-modules', () => ({
  callback: (fn: unknown) => fn,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
    children,
}));

describe('app', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  afterEach(async () => {
    await act(() => renderer.unmount());
  });

  test('opens on the library', async () => {
    await act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });
    expect(
      renderer.root.findAllByProps({ testID: 'library-screen' }).length,
    ).toBeGreaterThan(0);
  });

  test('an invalid pack shows the parse message and no renderer', async () => {
    const original = { ...bundledPack };
    try {
      Object.assign(bundledPack, {
        ok: false,
        error: { message: 'schema version 99 is not supported' },
      });
      await act(() => {
        renderer = ReactTestRenderer.create(<App />);
      });
      expect(
        renderer.root.findByProps({ testID: 'pack-error' }).props.children,
      ).toBe('schema version 99 is not supported');
      expect(
        renderer.root.findAllByType('SplatView' as React.ElementType),
      ).toHaveLength(0);
    } finally {
      Object.assign(bundledPack, original);
    }
  });
});

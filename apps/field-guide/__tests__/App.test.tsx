/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// The native view, gestures and Nitro runtime only exist on a device.
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
    children,
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: () => ({}),
}));
jest.mock('react-native-nitro-modules', () => ({ callback: (fn: unknown) => fn }));
jest.mock('react-native-splat', () => ({
  SplatView: 'SplatView',
  SplatDiagnostics: { snapshot: jest.fn(() => ({})) },
}));

test('renders correctly', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  // Stops the diagnostics polling so it cannot fire after the test.
  await ReactTestRenderer.act(() => renderer.unmount());
});

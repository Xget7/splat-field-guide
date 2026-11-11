import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { OfflineModels, OfflineModelStatus } from 'react-native-on-device';
import { fakeInstructor } from '@tests/voiceSession';
import { instructorStore } from '../state/instructorStore';
import { OfflinePreparation } from '../ui/OfflinePreparation';
import { NetworkQuality } from '../../../platform/connectivity/networkStatus';

test('observes shared preparation, reports progress and offers pause and retry', async () => {
  let status: OfflineModelStatus = {
    state: 'missing',
    progress: 0,
    bytes: 1.8e9,
    error: null,
  };
  const listeners = new Set<() => void>();
  const models: OfflineModels = {
    getSnapshot: () => status,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    restore: jest.fn(async () => {}),
    prepare: jest.fn(async () => {}),
    cancel: jest.fn(),
    release: jest.fn(),
  };
  instructorStore.getState().attach(fakeInstructor({ offlineModels: models }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const action = () =>
    renderer.root.findAll(
      item =>
        item.props.accessibilityRole === 'button' &&
        typeof item.props.onPress === 'function',
    )[0];
  const update = async (next: Partial<OfflineModelStatus>) => {
    await act(() => {
      status = { ...status, ...next };
      listeners.forEach(listener => listener());
    });
  };
  try {
    await act(() => {
      renderer = ReactTestRenderer.create(<OfflinePreparation />);
    });
    expect(models.prepare).not.toHaveBeenCalled();
    expect(action()).toBeUndefined();
    await act(() => instructorStore.getState().networkRouteChanged(true));
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Models not ready'),
    ).toBe(true);
    expect(action().props.accessibilityLabel).toBe('Continue model download');
    // A failed assistant proxy cannot block the model host over a working route.
    await act(() => {
      instructorStore.getState().networkChanged({
        ...instructorStore.getState().network,
        quality: NetworkQuality.offline,
      });
    });
    expect(action().props.accessibilityLabel).toBe('Continue model download');
    await act(() => action().props.onPress());
    expect(models.prepare).toHaveBeenCalledTimes(1);
    await update({ state: 'downloading', progress: 0.5 });
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Downloading models 50%'),
    ).toBe(true);
    await act(() => action().props.onPress());
    expect(models.cancel).toHaveBeenCalledTimes(1);
    await update({ state: 'error', error: 'network lost' });
    expect(action().props.accessibilityLabel).toBe('Retry model download');
    await update({ state: 'ready', progress: 1, error: null });
    expect(renderer.toJSON()).toBeNull();
    await act(() => renderer.update(<OfflinePreparation detailed />));
    const labels = () =>
      renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(labels()).toContain('Voice & AI');
    expect(labels()).toContain('Models ready');
    expect(labels()).toContain('Qwen2.5 / Whisper / Kokoro');
    expect(labels()).toContain('English, 1.8 GB');
    await update({ state: 'checking', progress: 0 });
    expect(labels()).toContain('Checking models…');
    expect(action()).toBeUndefined();
    await act(() => instructorStore.getState().networkRouteChanged(false));
    await update({ state: 'missing' });
    expect(labels()).toContain('Connect to prepare models');
    expect(labels()).not.toContain('Models ready');
    expect(action()).toBeUndefined();
    expect(models.prepare).toHaveBeenCalledTimes(1);
    await update({ state: 'ready', progress: 1 });
    expect(labels()).toContain('Models ready');
  } finally {
    await act(() => renderer.unmount());
    instructorStore.getState().reset();
  }
  expect(listeners.size).toBe(0);
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { OfflineModels, OfflineModelStatus } from 'react-native-on-device';
import { fakeInstructor } from '@tests/voiceSession';
import { Button } from '../../../ui/Button';
import { instructorStore } from '../state/instructorStore';
import { OfflinePreparation } from '../ui/OfflinePreparation';

test('prepares only on request, reports progress and offers cancellation and retry', async () => {
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
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => String(node.props.children).includes('1.8 GB')),
    ).toBe(true);
    await act(() => renderer.root.findByType(Button).props.onPress());
    expect(models.prepare).toHaveBeenCalledTimes(1);
    await update({ state: 'downloading', progress: 0.5 });
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Preparing offline guide: 50%'),
    ).toBe(true);
    await act(() => renderer.root.findByType(Button).props.onPress());
    expect(models.cancel).toHaveBeenCalledTimes(1);
    await update({ state: 'error', error: 'network lost' });
    expect(renderer.root.findByType(Button).props.label).toBe(
      'Prepare offline',
    );
    await update({ state: 'ready', progress: 1, error: null });
    expect(renderer.toJSON()).toBeNull();
  } finally {
    await act(() => renderer.unmount());
    instructorStore.getState().reset();
  }
  expect(listeners.size).toBe(0);
});

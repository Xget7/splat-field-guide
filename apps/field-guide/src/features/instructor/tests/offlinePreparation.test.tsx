import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { OfflineModels, OfflineModelStatus } from 'react-native-on-device';
import { offlineModelGroups } from '@tests/offlineModels';
import { fakeInstructor } from '@tests/voiceSession';
import { instructorStore } from '../state/instructorStore';
import { OfflinePreparation } from '../ui/OfflinePreparation';
import { NetworkQuality } from '../../../platform/connectivity/networkStatus';

test('shows functional group progress and preserves verified downloads on failure', async () => {
  let status: OfflineModelStatus = {
    state: 'missing',
    progress: 0,
    bytes: 300,
    error: null,
    models: offlineModelGroups('missing'),
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
    release: jest.fn(async () => {}),
    reserveScene: jest.fn(async () => ({ release: jest.fn() })),
  };
  instructorStore.getState().attach(fakeInstructor({ offlineModels: models }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const groupLabels = (id: string) =>
    renderer.root
      .findByProps({ testID: `offline-preparation-${id}` })
      .findAllByType(Text)
      .map(node => node.props.children);
  const progress = (
    states: readonly OfflineModelStatus['models'][number]['state'][],
  ) =>
    offlineModelGroups('missing').map((group, index) => ({
      ...group,
      state: states[index],
      bytes:
        states[index] === 'ready'
          ? group.total
          : states[index] === 'downloading'
          ? group.total / 2
          : 0,
      progress:
        states[index] === 'ready'
          ? 1
          : states[index] === 'downloading'
          ? 0.5
          : 0,
    }));
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
    expect(groupLabels('answers')).toEqual(['Answers', 'Not downloaded']);
    expect(groupLabels('listening')).toEqual(['Listening', 'Not downloaded']);
    expect(groupLabels('speaking')).toEqual(['Speaking', 'Not downloaded']);
    await act(() => instructorStore.getState().networkRouteChanged(true));
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === 'Offline tools'),
    ).toBe(true);
    expect(action().props.accessibilityLabel).toBe('Download offline tools');
    // A failed assistant proxy cannot block the model host over a working route.
    await act(() => {
      instructorStore.getState().networkChanged({
        ...instructorStore.getState().network,
        quality: NetworkQuality.offline,
      });
    });
    expect(action().props.accessibilityLabel).toBe('Download offline tools');
    await act(() => action().props.onPress());
    expect(models.prepare).toHaveBeenCalledTimes(1);
    await update({
      state: 'downloading',
      progress: 0.5,
      models: progress(['downloading', 'queued', 'queued']),
    });
    expect(groupLabels('answers')).toEqual(['Answers', '50%']);
    expect(groupLabels('listening')).toEqual(['Listening', 'Queued']);
    expect(groupLabels('speaking')).toEqual(['Speaking', 'Queued']);
    expect(
      renderer.root.findByProps({ accessibilityRole: 'progressbar' }).props
        .accessibilityValue.now,
    ).toBe(50);
    expect(action().props.accessibilityLabel).toBe('Pause offline tools');
    expect(
      renderer.root
        .findAllByType(Text)
        .some(node => node.props.children === '50%'),
    ).toBe(true);
    await act(() => action().props.onPress());
    expect(models.cancel).toHaveBeenCalledTimes(1);
    await update({ models: progress(['checking', 'queued', 'queued']) });
    expect(groupLabels('answers')).toEqual(['Answers', 'Verifying…']);
    await update({ models: progress(['ready', 'downloading', 'queued']) });
    expect(groupLabels('answers')).toEqual(['Answers', 'Ready']);
    expect(groupLabels('listening')).toEqual(['Listening', '50%']);
    await update({
      state: 'error',
      error: 'network lost',
      models: progress(['ready', 'error', 'queued']),
    });
    expect(groupLabels('answers')).toEqual(['Answers', 'Ready']);
    expect(groupLabels('listening')).toEqual(['Listening', 'Download failed']);
    expect(groupLabels('speaking')).toEqual(['Speaking', 'Queued']);
    expect(action().props.accessibilityLabel).toBe('Retry offline tools');
    await act(() => action().props.onPress());
    expect(models.prepare).toHaveBeenCalledTimes(2);
    await update({
      state: 'ready',
      progress: 1,
      error: null,
      models: offlineModelGroups('ready'),
    });
    expect(renderer.toJSON()).toBeNull();
    await act(() => renderer.update(<OfflinePreparation detailed />));
    const labels = () =>
      renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(labels()).toContain('Voice & AI');
    expect(groupLabels('answers')).toEqual(['Answers', 'Ready']);
    expect(groupLabels('listening')).toEqual(['Listening', 'Ready']);
    expect(groupLabels('speaking')).toEqual(['Speaking', 'Ready']);
    expect(labels().join(' ')).not.toMatch(/Qwen|Whisper|Kokoro|GB|English/);
    await update({
      state: 'checking',
      progress: 0,
      models: offlineModelGroups('checking'),
    });
    expect(groupLabels('answers')).toEqual(['Answers', 'Verifying…']);
    expect(action()).toBeUndefined();
    await act(() => instructorStore.getState().networkRouteChanged(false));
    await update({ state: 'missing', models: offlineModelGroups('missing') });
    expect(labels()).toContain('Connect to download');
    expect(labels()).not.toContain('Offline ready');
    expect(action()).toBeUndefined();
    expect(models.prepare).toHaveBeenCalledTimes(2);
    await update({
      state: 'ready',
      progress: 1,
      models: offlineModelGroups('ready'),
    });
    expect(labels()).toContain('Offline ready');
  } finally {
    await act(() => renderer.unmount());
    instructorStore.getState().reset();
  }
  expect(listeners.size).toBe(0);
});

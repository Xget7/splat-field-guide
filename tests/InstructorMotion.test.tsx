import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { ContentFade } from '../apps/field-guide/src/screens/viewer/instructor/InstructorMotion';

describe('instructor content fade', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  const content = (status: string) => (
    <ContentFade contentKey={status}>
      <Text>{status}</Text>
    </ContentFade>
  );
  const opacity = () =>
    StyleSheet.flatten(
      (renderer.toJSON() as ReactTestRenderer.ReactTestRendererJSON).props
        .style,
    ).opacity;

  afterEach(async () => {
    await act(() => renderer?.unmount());
    jest.mocked(useReducedMotion).mockReturnValue(false);
  });

  test.each([false, true])(
    'new content starts hidden unless Reduce Motion is enabled (%s)',
    async reducedMotion => {
      jest.mocked(useReducedMotion).mockReturnValue(reducedMotion);
      await act(() => {
        renderer = ReactTestRenderer.create(content('Starting'));
      });
      expect(opacity()).toBe(reducedMotion ? 1 : 0);
      // The animation adapter finishes timing immediately; render its settled value.
      await act(() => renderer.update(content('Starting')));
      expect(opacity()).toBe(1);
      const container = renderer.root.findByType(View);
      await act(() => renderer.update(content('Listening')));
      expect(renderer.root.findByType(View)).toBe(container);
      expect(renderer.root.findByType(Text).props.children).toBe('Listening');
      expect(opacity()).toBe(reducedMotion ? 1 : 0);
      await act(() => renderer.update(content('Listening')));
      expect(opacity()).toBe(1);
    },
  );

  test.each([null, undefined, false, true])(
    'empty React content (%s) takes no space and can fade in again',
    async empty => {
      await act(() => {
        renderer = ReactTestRenderer.create(content('Starting'));
      });
      await act(() =>
        renderer.update(
          <ContentFade contentKey="Starting">{empty}</ContentFade>,
        ),
      );
      expect(renderer.toJSON()).toBeNull();
      await act(() => renderer.update(content('Starting')));
      expect(opacity()).toBe(0);
    },
  );
});

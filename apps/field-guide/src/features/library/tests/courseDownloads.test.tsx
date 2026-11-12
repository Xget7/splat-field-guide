import React from 'react';
import { Text } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { instructorStore } from '../../instructor';
import { fakeInstructor } from '@tests/voiceSession';
import { CourseDownloads } from '../ui/CourseDownloads';

test('Downloads reports verified manuals separately from remote delivery and installed activities', async () => {
  instructorStore.getState().attach(fakeInstructor());
  let screen!: Renderer.ReactTestRenderer;
  await act(async () => {
    screen = Renderer.create(
      <CourseDownloads
        sceneAvailable
        moduleCount={4}
        documents={{
          list: async () => [
            {
              id: 'manual',
              title: 'Manual',
              edition: 'V4',
              issued: '2012',
              pages: 243,
              available: true,
            },
          ],
          open: async () => {},
        }}
        onBack={jest.fn()}
      />,
    );
  });
  const text = screen.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Available on device');
  expect(text).toContain('4 available on device');
  expect(text).toContain('Course downloads are not available yet.');
  await act(() => screen.unmount());
});

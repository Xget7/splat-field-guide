import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { CourseDocumentation } from '../ui/CourseDocumentation';

test('opens the verified offline manual and reports an opening failure with retry', async () => {
  const documents = {
    list: jest.fn(async () => [
      {
        id: 'kuka-quantec-extra-v4',
        title: 'Operating instructions',
        edition: 'BA KR QUANTEC extra V4 en',
        issued: '2012-11-29',
        pages: 243,
        pageOffset: 0,
        available: true,
      },
    ]),
    open: jest.fn(async () => {
      throw new Error('unreadable');
    }),
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CourseDocumentation documents={documents} />,
    );
  });
  const button = renderer!.root
    .findAllByProps({ testID: 'document-kuka-quantec-extra-v4' })
    .find(node => node.props.accessibilityRole === 'button')!;
  expect(button.props.accessibilityState.disabled).toBe(false);
  await act(() => button.props.onPress());
  expect(documents.open).toHaveBeenCalledWith('kuka-quantec-extra-v4');
  expect(
    renderer!.root
      .findAllByType(Text)
      .some(
        node =>
          node.props.children === 'Could not open this document. Try again.',
      ),
  ).toBe(true);
  await act(async () => {
    renderer!.root
      .findAllByProps({ accessibilityLabel: 'Retry documentation' })
      .find(node => node.props.onPress)!
      .props.onPress();
  });
  expect(documents.list).toHaveBeenCalledTimes(2);
  await act(() => renderer!.unmount());
});

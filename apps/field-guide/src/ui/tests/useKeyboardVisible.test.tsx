import { Keyboard, Platform, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useKeyboardVisible } from '../useKeyboardVisible';

function Visibility() {
  return <Text>{String(useKeyboardVisible())}</Text>;
}

test.each([
  ['ios', 'keyboardWillShow', 'keyboardWillHide'],
  ['android', 'keyboardDidShow', 'keyboardDidHide'],
] as const)(
  '%s keyboard events update visibility and release listeners',
  async (os, show, hide) => {
    jest.replaceProperty(Platform, 'OS', os);
    const remove = jest.fn();
    const listen = jest
      .spyOn(Keyboard, 'addListener')
      .mockReturnValue({ remove });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    try {
      await act(() => {
        renderer = ReactTestRenderer.create(<Visibility />);
      });
      const emit = async (event: string) => {
        const handler = listen.mock.calls.find(([name]) => name === event)?.[1];
        expect(handler).toBeDefined();
        await act(() => {
          handler?.({} as never);
        });
      };
      await emit(show);
      expect(renderer.root.findByType(Text).props.children).toBe('true');
      await emit(hide);
      expect(renderer.root.findByType(Text).props.children).toBe('false');
      await act(() => renderer.unmount());
      expect(remove).toHaveBeenCalledTimes(2);
    } finally {
      await act(() => renderer?.unmount());
      jest.restoreAllMocks();
    }
  },
);

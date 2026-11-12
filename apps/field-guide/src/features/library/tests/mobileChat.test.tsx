import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Dimensions, Keyboard, StyleSheet, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { fixturePack } from '@tests/fixturePack';
import { fakeInstructor } from '@tests/voiceSession';
import { instructorStore } from '../../instructor';
import { catalogFor } from '../../pack/catalog';
import { LibraryScreen } from '../ui/LibraryScreen';
import { CourseAssistant } from '../ui/CourseAssistant';

const PHONE = { width: 393, height: 852, scale: 3, fontScale: 1 };
const TABLET = { width: 1366, height: 1024, scale: 2, fontScale: 1 };
const catalog = catalogFor([fixturePack()]);
const navigation = {
  isFocused: () => true,
  addListener: () => () => {},
};

describe('phone course conversation', () => {
  let screen: Renderer.ReactTestRenderer;
  let window: ReturnType<typeof Dimensions.get>;
  const keyboard = new Map<string, () => void>();
  const button = (id: string) =>
    screen.root
      .findAllByProps({ testID: id })
      .find(node => node.props.onPress)!;
  const field = () =>
    screen.root
      .findAllByProps({ testID: 'course-question' })
      .find(node => node.props.onChangeText)!;
  const press = async (id: string) => {
    await act(async () => button(id).props.onPress());
  };
  const suggestions = () =>
    screen.root
      .findAllByType(Text)
      .some(node => node.props.children === 'Where is the A5 axis motor?');
  beforeEach(() => {
    window = Dimensions.get('window');
    Dimensions.set({ window: PHONE, screen: PHONE });
    instructorStore.getState().attach(fakeInstructor());
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((event, listener) => {
        keyboard.set(event, () => listener({} as never));
        return { remove: () => keyboard.delete(event) };
      });
  });
  afterEach(async () => {
    if (screen) await act(async () => screen.unmount());
    Dimensions.set({ window, screen: window });
    keyboard.clear();
    jest.restoreAllMocks();
  });

  async function openLibraryChat() {
    await act(async () => {
      screen = Renderer.create(
        <NavigationContext.Provider
          value={
            navigation as unknown as React.ContextType<typeof NavigationContext>
          }
        >
          <LibraryScreen
            catalog={catalog}
            progress={{ load: async () => null }}
            onOpen={jest.fn()}
            onOpenGuide={jest.fn()}
          />
        </NavigationContext.Provider>,
      );
    });
    await press('open-organization-miris');
    await press('open-course-automotive-assembly-line');
    await act(async () => field().props.onChangeText('Hello'));
    await press('course-send');
  }

  test('uses the full phone width for chat and restores workspace navigation on back', async () => {
    await openLibraryChat();
    expect(
      screen.root.findAllByProps({ testID: 'navigation-organizations' }),
    ).toHaveLength(0);
    expect(
      StyleSheet.flatten(
        screen.root.findByProps({ testID: 'course-chat-header' }).props.style,
      ).minHeight,
    ).toBe(56);
    expect(
      StyleSheet.flatten(
        screen.root.findByProps({ testID: 'course-composer' }).props.style,
      ),
    ).toMatchObject({ minHeight: 64, flexDirection: 'row' });
    expect(suggestions()).toBe(false);
    await press('course-chat-back');
    expect(button('navigation-organizations')).toBeDefined();
  });

  test('keeps the tablet navigation and roomy chat composition', async () => {
    Dimensions.set({ window: TABLET, screen: TABLET });
    await openLibraryChat();
    expect(button('navigation-organizations')).toBeDefined();
    expect(
      StyleSheet.flatten(
        screen.root.findByProps({ testID: 'course-chat-header' }).props.style,
      ).minHeight,
    ).toBe(80);
    expect(
      StyleSheet.flatten(
        screen.root.findByProps({ testID: 'course-composer' }).props.style,
      ).minHeight,
    ).toBe(128);
    expect(suggestions()).toBe(true);
  });

  test('hides empty-chat suggestions while the phone keyboard is open', async () => {
    await act(async () => {
      screen = Renderer.create(
        <NavigationContext.Provider
          value={
            navigation as unknown as React.ContextType<typeof NavigationContext>
          }
        >
          <CourseAssistant
            guide={catalog[0]}
            question={null}
            onOpen={jest.fn()}
            onDocument={jest.fn()}
          />
        </NavigationContext.Provider>,
      );
    });
    expect(suggestions()).toBe(true);
    await act(async () => keyboard.get('keyboardWillShow')?.());
    expect(suggestions()).toBe(false);
    await act(async () => keyboard.get('keyboardWillHide')?.());
    expect(suggestions()).toBe(true);
  });
});

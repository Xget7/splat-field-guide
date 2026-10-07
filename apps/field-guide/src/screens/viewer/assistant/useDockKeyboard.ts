import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  type KeyboardEvent,
  type ViewInstance,
} from 'react-native';

/** Measure the anchor so a parent that already avoids the keyboard is not offset twice. */
export function useDockKeyboard(gap: number) {
  const anchor = useRef<ViewInstance>(null);
  const frame = useRef(Keyboard.metrics());
  const [overlap, setOverlap] = useState(0);
  const measure = useCallback(() => {
    const keyboard = frame.current;
    if (keyboard == null) {
      setOverlap(0);
      return;
    }
    anchor.current?.measureInWindow((x, y, width, height) => {
      if (frame.current !== keyboard) {
        return;
      }
      const intersects =
        x < keyboard.screenX + keyboard.width &&
        x + width > keyboard.screenX &&
        y < keyboard.screenY + keyboard.height;
      setOverlap(
        intersects ? Math.max(0, y + height - keyboard.screenY + gap) : 0,
      );
    });
  }, [gap]);
  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      frame.current = event.endCoordinates;
      measure();
    };
    const hide = () => {
      frame.current = undefined;
      setOverlap(0);
    };
    const listeners =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', update),
            Keyboard.addListener('keyboardWillHide', hide),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', update),
            Keyboard.addListener('keyboardDidHide', hide),
          ];
    return () => listeners.forEach(listener => listener.remove());
  }, [measure]);
  return { anchor, overlap, measure };
}

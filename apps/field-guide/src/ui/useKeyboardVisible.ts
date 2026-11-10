import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** iOS will* events track its animation; Android only reports did* events. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setVisible(true),
    );
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setVisible(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}

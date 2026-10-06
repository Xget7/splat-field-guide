import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/** The will* events keep panel movement in step with the keyboard. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardWillShow', () =>
      setVisible(true),
    );
    const hidden = Keyboard.addListener('keyboardWillHide', () =>
      setVisible(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}

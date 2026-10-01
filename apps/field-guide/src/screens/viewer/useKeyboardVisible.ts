import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/** Whether the software keyboard is up; the will* events keep a panel in step with it. */
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

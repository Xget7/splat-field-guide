import { StyleSheet } from 'react-native';
import {
  BUTTON_HEIGHT,
  Color,
  HAIRLINE,
  Radius,
  Space,
} from '../../../ui/theme';

const COMPOSER_BUTTON = 36;

// Match the Next button's height so composer and navigation rows align.
export const Composer = {
  height: BUTTON_HEIGHT,
  button: COMPOSER_BUTTON,
  inset: (BUTTON_HEIGHT - COMPOSER_BUTTON) / 2,
} as const;

export const composerStyles = StyleSheet.create({
  frame: {
    height: Composer.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.lg,
    paddingRight: Composer.inset,
    borderRadius: Radius.round,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.raised,
  },
  // Distinguish an open microphone from an editable text field.
  open: { borderColor: Color.accent },
  insetButton: { borderRadius: Radius.round },
  quietButton: {
    borderRadius: Radius.round,
    borderWidth: 0,
    backgroundColor: Color.pressed,
  },
});

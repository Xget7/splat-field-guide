import { useWindowDimensions } from 'react-native';

// Narrower than any iPad's window in either orientation, wider than any iPhone's.
export const WIDE_LAYOUT_MIN_WIDTH = 700;

/** Room for content side by side, as on an iPad, rather than stacked as on a phone. */
export function useWideLayout(): boolean {
  return useWindowDimensions().width >= WIDE_LAYOUT_MIN_WIDTH;
}

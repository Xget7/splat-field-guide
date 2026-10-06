import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Color } from './theme';

export const IconName = {
  back: 'back',
  next: 'next',
  down: 'down',
  mic: 'mic',
  micOff: 'micOff',
  handsFree: 'handsFree',
  camera: 'camera',
  chat: 'chat',
  repeat: 'repeat',
  warn: 'warn',
  check: 'check',
  lock: 'lock',
  search: 'search',
  close: 'close',
  keyboard: 'keyboard',
  send: 'send',
  play: 'play',
  list: 'list',
  stop: 'stop',
  explore: 'explore',
  frame: 'frame',
  flash: 'flash',
} as const;
export type IconName = (typeof IconName)[keyof typeof IconName];

const VIEW_BOX = '0 0 24 24';
const DEFAULT_SIZE = 20;
const DEFAULT_STROKE = 2;

// Strokes on a 24 point grid; filled shapes say so.
const SHAPES: Readonly<Record<IconName, (color: string) => ReactNode>> = {
  back: () => <Path d="M15 18l-6-6 6-6" />,
  next: () => <Path d="M9 18l6-6-6-6" />,
  down: () => <Path d="M6 9l6 6 6-6" />,
  mic: () => (
    <>
      <Rect x={9} y={2.5} width={6} height={12} rx={3} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
    </>
  ),
  micOff: () => (
    <>
      <Path d="M15 9.5V5.5a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.8 2.4" />
      <Path d="M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3.5M3 3l18 18" />
    </>
  ),
  // Sound waves: the instructor hears without a hold.
  handsFree: () => <Path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />,
  camera: () => (
    <>
      <Path d="M3 8a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Circle cx={12} cy={13} r={3.5} />
    </>
  ),
  chat: () => <Path d="M20 11a8 8 0 0 1-8 8H4l-2 3V11a9 9 0 0 1 18 0z" />,
  repeat: () => <Path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  warn: () => <Path d="M12 3.5L2.5 20h19zM12 10v4M12 17h.01" />,
  check: () => <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  lock: () => (
    <>
      <Rect x={5} y={11} width={14} height={10} rx={1.5} />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  search: () => (
    <>
      <Circle cx={11} cy={11} r={7} />
      <Path d="M20 20l-3.5-3.5" />
    </>
  ),
  close: () => <Path d="M6 6l12 12M18 6L6 18" />,
  keyboard: () => (
    <>
      <Rect x={2} y={6} width={20} height={12} rx={2} />
      <Path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  send: () => <Path d="M12 19V5M5 12l7-7 7 7" />,
  play: color => <Path d="M8 5.5v13l10.5-6.5z" fill={color} />,
  list: () => (
    <Path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  ),
  // A box in three dimensions: free to turn the capture and look at any part.
  explore: () => (
    <Path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5zM3.5 7.25L12 12l8.5-4.75M12 12v9.5" />
  ),
  // The corners the viewer draws around a part, here around everything.
  frame: () => (
    <Path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8M16 3h3.5A1.5 1.5 0 0 1 21 4.5V8M21 16v3.5a1.5 1.5 0 0 1-1.5 1.5H16M8 21H4.5A1.5 1.5 0 0 1 3 19.5V16" />
  ),
  flash: () => <Path d="M13.5 2.5L5 13h6l-.5 8.5L19 11h-6z" />,
  stop: color => (
    <Rect
      x={6}
      y={6}
      width={12}
      height={12}
      rx={2}
      fill={color}
      stroke="none"
    />
  ),
};

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = DEFAULT_SIZE,
  color = Color.text,
  strokeWidth = DEFAULT_STROKE,
}: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
    >
      {SHAPES[name](color)}
    </Svg>
  );
}

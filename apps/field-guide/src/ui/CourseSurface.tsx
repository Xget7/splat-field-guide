import { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SvgFill } from './Gradients';
import { CourseColor as C } from './courseTokens';

export function CourseSurface() {
  return (
    <SvgFill>
      {({ width, height }) => (
        <>
          <Defs>
            <LinearGradient id="course-depth" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={C.raised} />
              <Stop offset="0.45" stopColor={C.surface} />
              <Stop offset="1" stopColor={C.canvas} />
            </LinearGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#course-depth)" />
        </>
      )}
    </SvgFill>
  );
}

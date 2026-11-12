import { useEffect, useMemo, useRef } from 'react';
import type { SplatViewSpec, ViewDirection } from 'react-native-splat';
import { directionFor, framingFor, type SessionState } from '../../../guide';
import type { Bounds, Pack } from '../../../pack/pack';

import {
  CLOSE_UP_SECONDS,
  FRAME_SECONDS,
  homeDirectionInRadians,
  guideFrameBounds,
  INITIAL_FRAME_SECONDS,
  transitionBetween,
} from '../../domain/camera';
import type { Size } from '../../domain/screenGeometry';

interface FramedInputs {
  view: SplatViewSpec;
  framing: Bounds;
  closeUp: boolean;
  from: ViewDirection;
  frameRequest: number;
  width: number;
  height: number;
  settlement: number;
}

/** Hides the viewport, runs the jump while hidden, then shows it again. */
export type CameraCut = (jump: () => void) => void;

/** Reframe after aspect changes because framing depends on the viewport shape. */
export function useGuideFraming(
  view: SplatViewSpec | null,
  state: SessionState,
  pack: Pack,
  frameRequest: number,
  viewport: Size,
  animatedResize = false,
  settlement = 0,
  closeUp = false,
  reducedMotion = false,
  cut: CameraCut = jump => jump(),
) {
  const framing = useMemo(() => framingFor(state, pack), [state, pack]);
  const from = useMemo(
    () => homeDirectionInRadians(directionFor(state, pack)),
    [state, pack],
  );
  const framed = useRef<FramedInputs | null>(null);
  const { width, height } = viewport;

  useEffect(() => {
    if (view === null || framing === null || width === 0 || height === 0) {
      // The dev audit temporarily releases this hook, then restores the guide camera.
      if (__DEV__) {
        framed.current = null;
      }
      return;
    }
    const previous = framed.current;
    const changedScene =
      previous === null ||
      previous.view !== view ||
      previous.framing !== framing ||
      previous.from !== from ||
      previous.frameRequest !== frameRequest;
    const changedSize =
      previous?.width !== width || previous?.height !== height;
    const changedDistance = previous?.closeUp !== closeUp;
    if (!changedScene && !changedSize && !changedDistance) {
      previous.settlement = settlement;
      return;
    }
    // Layout changes on the UI thread; only its completed transition reframes a resize.
    if (
      !changedScene &&
      !changedDistance &&
      animatedResize &&
      previous.settlement === settlement
    ) {
      return;
    }
    const bounds = guideFrameBounds(framing, closeUp);
    const pushIn = !changedScene && !changedSize;
    if (pushIn) {
      // A push-in keeps the direction the user chose by orbiting.
      view.frame(bounds, CLOSE_UP_SECONDS);
    } else if (previous?.view !== view) {
      view.frame(bounds, INITIAL_FRAME_SECONDS, from);
    } else if (!changedScene) {
      view.frame(bounds, FRAME_SECONDS, from);
    } else {
      const transition = transitionBetween(
        view.drawnDirection(),
        from,
        reducedMotion,
      );
      if (transition.kind === 'cut') {
        cut(() => view.frame(bounds, INITIAL_FRAME_SECONDS, from));
      } else {
        view.frame(bounds, transition.seconds, from);
      }
    }
    framed.current = {
      view,
      framing,
      closeUp,
      from,
      frameRequest,
      width,
      height,
      settlement,
    };
  }, [
    framing,
    closeUp,
    from,
    view,
    frameRequest,
    width,
    height,
    animatedResize,
    settlement,
    reducedMotion,
    cut,
  ]);
}

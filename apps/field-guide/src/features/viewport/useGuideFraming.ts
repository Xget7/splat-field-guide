import { useEffect, useMemo, useRef } from 'react';
import type { SplatViewSpec, ViewDirection } from 'react-native-splat';
import { framingFor } from '../guide/derive';
import type { Bounds, Pack } from '../pack/pack';
import type { SessionState } from '../guide/session';
import {
  boundsForView,
  CLOSE_UP_SCALE,
  CLOSE_UP_SECONDS,
  CONTEXT_SCALE,
  FRAME_SECONDS,
  homeDirectionInRadians,
  inContext,
  INITIAL_FRAME_SECONDS,
} from './camera';
import type { Size } from './PartMarkers';

interface FramedInputs {
  view: SplatViewSpec;
  framing: Bounds;
  closeUp: boolean;
  from: ViewDirection | undefined;
  frameRequest: number;
  width: number;
  height: number;
  settlement: number;
}

/**
 * Frames what the step shows whenever it changes, when asked again (`frameRequest`), and when
 * the viewport changes shape, since a framing only fits the aspect it was made for. While the
 * instructor talks about it (`closeUp`), the camera moves in from wherever it is looking.
 */
export function useGuideFraming(
  view: SplatViewSpec | null,
  state: SessionState,
  pack: Pack,
  frameRequest: number,
  viewport: Size,
  animatedResize = false,
  settlement = 0,
  closeUp = false,
) {
  const framing = useMemo(() => framingFor(state, pack), [state, pack]);
  const home = useMemo(() => homeDirectionInRadians(pack.camera.home), [pack]);
  const from = state.selectedPart === null ? home : undefined;
  const framed = useRef<FramedInputs | null>(null);
  const { width, height } = viewport;

  useEffect(() => {
    if (view === null || framing === null || width === 0 || height === 0) {
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
    const bounds = boundsForView(
      inContext(framing, closeUp ? CLOSE_UP_SCALE : CONTEXT_SCALE),
    );
    const pushIn = !changedScene && !changedSize;
    const seconds =
      previous?.view !== view
        ? INITIAL_FRAME_SECONDS
        : pushIn
        ? CLOSE_UP_SECONDS
        : FRAME_SECONDS;
    if (from === undefined || pushIn) {
      // A picked part, and a push-in, keep the direction the user chose by orbiting.
      view.frame(bounds, seconds);
    } else {
      view.frame(bounds, seconds, from);
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
  ]);
}

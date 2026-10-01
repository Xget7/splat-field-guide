import { useEffect, useMemo, useRef } from 'react';
import type { SplatViewSpec, ViewDirection } from 'react-native-splat';
import { framingFor } from '../../../domain/derive';
import type { Pack } from '../../../domain/pack';
import type { SessionState } from '../../../domain/session';
import {
  boundsForView,
  FRAME_SECONDS,
  homeDirectionInRadians,
  inContext,
  INITIAL_FRAME_SECONDS,
} from '../model/camera';
import type { Size } from '../components/PartMarkers';

interface FramedInputs {
  view: SplatViewSpec;
  bounds: ReturnType<typeof boundsForView>;
  from: ViewDirection | undefined;
  frameRequest: number;
  width: number;
  height: number;
  settlement: number;
}

/**
 * Frames what the step shows whenever it changes, when asked again (`frameRequest`), and when
 * the viewport changes shape, since a framing only fits the aspect it was made for.
 */
export function useGuideFraming(
  view: SplatViewSpec | null,
  state: SessionState,
  pack: Pack,
  frameRequest: number,
  viewport: Size,
  animatedResize = false,
  settlement = 0,
) {
  const bounds = useMemo(() => {
    const framing = framingFor(state, pack);
    return framing === null ? null : boundsForView(inContext(framing));
  }, [state, pack]);
  const home = useMemo(() => homeDirectionInRadians(pack.camera.home), [pack]);
  const from = state.selectedPart === null ? home : undefined;
  const framed = useRef<FramedInputs | null>(null);
  const { width, height } = viewport;

  useEffect(() => {
    if (view === null || bounds === null || width === 0 || height === 0) {
      return;
    }
    const previous = framed.current;
    const changedScene =
      previous === null ||
      previous.view !== view ||
      previous.bounds !== bounds ||
      previous.from !== from ||
      previous.frameRequest !== frameRequest;
    const changedSize =
      previous?.width !== width || previous?.height !== height;
    if (!changedScene && !changedSize) {
      previous.settlement = settlement;
      return;
    }
    // Layout changes on the UI thread; only its completed transition reframes a resize.
    if (!changedScene && animatedResize && previous.settlement === settlement) {
      return;
    }
    const seconds =
      previous?.view === view ? FRAME_SECONDS : INITIAL_FRAME_SECONDS;
    if (from === undefined) {
      // A picked part keeps the direction the user chose by orbiting.
      view.frame(bounds, seconds);
    } else {
      view.frame(bounds, seconds, from);
    }
    framed.current = {
      view,
      bounds,
      from,
      frameRequest,
      width,
      height,
      settlement,
    };
  }, [
    bounds,
    from,
    view,
    frameRequest,
    width,
    height,
    animatedResize,
    settlement,
  ]);
}

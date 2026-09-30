import { useEffect, useMemo, useRef } from 'react';
import type { SplatViewSpec } from 'react-native-splat';
import { framingFor } from '../domain/derive';
import type { Pack } from '../domain/pack';
import type { SessionState } from '../domain/session';
import {
  boundsForView,
  FRAME_SECONDS,
  homeDirectionInRadians,
  INITIAL_FRAME_SECONDS,
} from './camera';

export function useGuideFraming(
  view: SplatViewSpec | null,
  state: SessionState,
  pack: Pack,
) {
  const bounds = useMemo(() => {
    const framing = framingFor(state, pack);
    return framing === null ? null : boundsForView(framing);
  }, [state, pack]);
  const home = useMemo(() => homeDirectionInRadians(pack.camera.home), [pack]);
  const from = state.selectedPart === null ? home : undefined;
  const framedView = useRef<SplatViewSpec | null>(null);

  useEffect(() => {
    if (view === null || bounds === null) {
      return;
    }
    const seconds =
      framedView.current === view ? FRAME_SECONDS : INITIAL_FRAME_SECONDS;
    if (from === undefined) {
      // A picked part keeps the direction the user chose by orbiting.
      view.frame(bounds, seconds);
    } else {
      view.frame(bounds, seconds, from);
    }
    framedView.current = view;
  }, [bounds, from, view]);
}

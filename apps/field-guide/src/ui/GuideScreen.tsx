import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SplatError, SplatViewSpec } from 'react-native-splat';
import { highlightFor } from '../domain/derive';
import type { Pack } from '../domain/pack';
import {
  INITIAL_SESSION,
  reduce,
  SessionEventType,
  type SessionEvent,
  type SessionState,
} from '../domain/session';
import { TOUR_ID } from '../domain/tour';
import { cardContentFor, nextEventFor, partIdForLabel } from './guideContent';
import { SplatViewport } from './SplatViewport';
import { StepCard } from './StepCard';
import { Color } from './theme';
import { useGuideFraming } from './useGuideFraming';

export interface FieldGuideDebug {
  view: SplatViewSpec | null;
  dispatch: Dispatch<SessionEvent>;
  getState: () => SessionState;
  pack: Pack;
}

export function GuideScreen({ pack }: { pack: Pack }) {
  const [state, dispatch] = useReducer(
    (current: SessionState, event: SessionEvent) =>
      reduce(current, event, pack),
    pack,
    initialPack =>
      reduce(
        INITIAL_SESSION,
        { type: SessionEventType.start, procedureId: TOUR_ID },
        initialPack,
      ),
  );
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();
  const highlight = useMemo(
    () => [...highlightFor(state, pack)],
    [state, pack],
  );
  const stateRef = useRef(state);
  const pickGeneration = useRef(0);

  useGuideFraming(view, state, pack);

  useEffect(() => {
    stateRef.current = state;
    // Metro end-to-end checks can drive the live screen in development only.
    if (__DEV__) {
      const target = globalThis as { fieldGuide?: FieldGuideDebug };
      const debug = { view, dispatch, getState: () => stateRef.current, pack };
      target.fieldGuide = debug;
      return () => {
        if (target.fieldGuide === debug) {
          delete target.fieldGuide;
        }
      };
    }
  }, [state, view, pack]);

  useEffect(() => {
    // A delayed pick must not overwrite a newer step or an unmounted screen.
    pickGeneration.current += 1;
    return () => {
      pickGeneration.current += 1;
    };
  }, [state, view, pack]);

  const onPick = useCallback(
    async (x: number, y: number) => {
      if (view === null) {
        return;
      }
      const generation = ++pickGeneration.current;
      try {
        const label = await view.pick(x, y);
        if (generation !== pickGeneration.current) {
          return;
        }
        const partId = partIdForLabel(label, pack);
        if (partId !== undefined) {
          dispatch({ type: SessionEventType.select, partId });
        }
      } catch (thrown) {
        if (generation === pickGeneration.current) {
          setError(thrown instanceof Error ? thrown.message : String(thrown));
        }
      }
    },
    [view, pack],
  );
  const onReady = useCallback(() => setError(''), []);
  const onError = useCallback(
    (failure: SplatError) => setError(failure.message),
    [],
  );
  const onView = useCallback((ref: SplatViewSpec) => setView(ref), []);
  const onBack = useCallback(
    () => dispatch({ type: SessionEventType.back }),
    [],
  );
  const onNext = useCallback(
    () => dispatch(nextEventFor(state, pack)),
    [state, pack],
  );
  const onRepeat = useCallback(
    () => dispatch({ type: SessionEventType.repeat }),
    [],
  );

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <SplatViewport
        pack={pack}
        highlight={highlight}
        view={view}
        error={error}
        onView={onView}
        onReady={onReady}
        onError={onError}
        onPick={onPick}
      />
      <StepCard
        content={cardContentFor(state, pack)}
        onBack={onBack}
        onNext={onNext}
        onRepeat={onRepeat}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
});

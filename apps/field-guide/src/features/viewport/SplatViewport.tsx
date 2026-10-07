import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { callback } from 'react-native-nitro-modules';
import {
  SplatView,
  type SplatError,
  type SplatViewSpec,
} from 'react-native-splat';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, {
  useReducedMotion,
  type LinearTransition,
} from 'react-native-reanimated';
import { highlightFor } from '../guide/derive';
import { currentStep, type SessionState } from '../guide/session';
import { packFacts } from '../pack/catalog';
import type { Pack, PartId } from '../pack/pack';
import { sourceFor } from '../pack/bundledPack';
import { Icon, IconName } from '../../ui/Icon';
import { Label } from '../../ui/Label';
import { Color, HAIRLINE, Motion, Radius, Space, Type } from '../../ui/theme';
import { cameraLimitsInRadians } from './camera';
import { PartMarkers } from './PartMarkers';
import {
  ProjectedPartsContext,
  useProjectedParts,
  type Size,
} from './projectedParts';
import { useGuideFraming } from './useGuideFraming';

const RADIANS_PER_POINT = 0.01;
const PAN_ACTIVATION_POINTS = 8;
const TAP_MAX_DISTANCE_POINTS = 8;
const ERROR_ICON = 16;
const MS_PER_SECOND = 1000;

const NO_SIZE: Size = { width: 0, height: 0 };

interface Props {
  pack: Pack;
  session: SessionState;
  frameRequest: number;
  closeUp: boolean;
  accessibilityLabel: string;
  resizeTransition?: LinearTransition;
  /** Off hides the part labels drawn over the cloud. */
  markers?: boolean;
  /** A part a child card labels in place of its tag, through `useProjection`. */
  carded?: PartId | null;
  onSelect: (partId: PartId | null) => void;
  children?: ReactNode;
}

export function SplatViewport(props: Props) {
  // A different pack gets a fresh native lifetime, including readiness and pending picks.
  return (
    <Viewport
      key={`${props.pack.packId}:${props.pack.packVersion}`}
      {...props}
    />
  );
}

function Viewport({
  pack,
  session,
  frameRequest,
  closeUp,
  accessibilityLabel,
  resizeTransition,
  markers = true,
  carded = null,
  onSelect,
  children,
}: Props) {
  const [view, setView] = useState<SplatViewSpec | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState(NO_SIZE);
  const [settlement, setSettlement] = useState(0);
  const reducedMotion = useReducedMotion();
  const materialize = !reducedMotion;
  const highlight = useMemo(
    () => [...highlightFor(session, pack)],
    [session, pack],
  );
  const parts = useMemo(() => {
    const ids =
      session.selectedPart === null
        ? currentStep(session, pack)?.parts ?? []
        : [session.selectedPart];
    return ids.flatMap(id => pack.parts.filter(part => part.id === id));
  }, [session, pack]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const currentInputs = useRef({
    session,
    pack,
    view,
    frameRequest,
    closeUp,
    size,
  });
  currentInputs.current = { session, pack, view, frameRequest, closeUp, size };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  const settleResize = useCallback(() => {
    if (mounted.current) {
      setSettlement(value => value + 1);
    }
  }, []);
  const layout = useMemo(
    () =>
      resizeTransition?.withCallback(finished => {
        'worklet';
        if (finished) {
          scheduleOnRN(settleResize);
        }
      }),
    [resizeTransition, settleResize],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(current =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);
  const onView = useCallback((native: SplatViewSpec) => {
    generation.current += 1;
    const previous = currentInputs.current.view;
    if (previous !== null && previous !== native) {
      setReady(false);
    }
    setView(native);
  }, []);
  const onReady = useCallback(() => {
    setReady(true);
    setError('');
  }, []);
  const onError = useCallback((failure: SplatError) => {
    generation.current += 1;
    setReady(false);
    setError(failure.message);
  }, []);
  const activeView = ready ? view : null;
  const { boxes, viewport } = useProjectedParts(activeView, parts, size);
  const projection = useMemo(
    () => ({ ids: parts.map(part => part.id), boxes, viewport }),
    [parts, boxes, viewport],
  );
  useGuideFraming(
    activeView,
    session,
    pack,
    frameRequest,
    size,
    resizeTransition !== undefined,
    settlement,
    closeUp,
  );
  const source = useMemo(() => sourceFor(pack), [pack]);
  const limits = useMemo(
    () => cameraLimitsInRadians(pack.camera.limits),
    [pack],
  );
  const pick = useCallback(
    async (x: number, y: number) => {
      if (activeView === null || size.width <= 0 || size.height <= 0) {
        return;
      }
      const inputs = currentInputs.current;
      const id = ++generation.current;
      const current = () =>
        mounted.current &&
        generation.current === id &&
        currentInputs.current.session.procedureId ===
          inputs.session.procedureId &&
        currentInputs.current.session.stepIndex === inputs.session.stepIndex &&
        currentInputs.current.session.selectedPart ===
          inputs.session.selectedPart &&
        currentInputs.current.frameRequest === inputs.frameRequest &&
        currentInputs.current.closeUp === inputs.closeUp &&
        currentInputs.current.size === inputs.size &&
        currentInputs.current.pack === inputs.pack &&
        currentInputs.current.view === inputs.view;
      try {
        const label = await activeView.pick(x / size.width, y / size.height);
        if (current()) {
          const part =
            label === 0
              ? null
              : pack.parts.find(candidate => candidate.label === label)?.id;
          if (part !== undefined) {
            onSelect(part);
          }
        }
      } catch (failure) {
        if (current()) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
      }
    },
    [activeView, size, pack, onSelect],
  );

  const pan = usePanGesture({
    minDistance: PAN_ACTIVATION_POINTS,
    maxPointers: 1,
    onUpdate: event => {
      'worklet';
      if (event.numberOfPointers === 1) {
        activeView?.orbit(
          -event.changeX * RADIANS_PER_POINT,
          event.changeY * RADIANS_PER_POINT,
        );
      }
    },
  });
  const pinch = usePinchGesture({
    onUpdate: event => {
      'worklet';
      activeView?.dolly(event.scaleChange);
    },
  });
  const tap = useTapGesture({
    maxDistance: TAP_MAX_DISTANCE_POINTS,
    onActivate: event => {
      'worklet';
      scheduleOnRN(pick, event.x, event.y);
    },
  });
  const movement = useSimultaneousGestures(pan, pinch);
  // Tap waits for both movement gestures to fail, so dragging cannot pick.
  const gesture = useExclusiveGestures(movement, tap);

  return (
    <Animated.View
      testID="viewer-viewport"
      layout={layout}
      onLayout={onLayout}
      style={styles.root}
    >
      <GestureDetector gesture={gesture}>
        <View
          testID="guide-viewport"
          style={styles.root}
          accessible
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Drag to orbit, pinch to zoom, or tap a part to select it."
        >
          <SplatView
            style={styles.root}
            source={source}
            highlight={highlight}
            cameraLimits={limits}
            revealSeconds={
              materialize ? Motion.reveal / MS_PER_SECOND : undefined
            }
            onReady={callback(onReady)}
            onError={callback(onError)}
            hybridRef={callback(onView)}
          />
        </View>
      </GestureDetector>
      {!ready && error === '' && (
        <View pointerEvents="none" style={styles.loading}>
          <Label testID="splat-loading" color={Color.muted}>
            {`Loading ${packFacts(pack).splats} splats`}
          </Label>
        </View>
      )}
      {ready && markers && (
        <PartMarkers
          parts={parts}
          projection={projection}
          carded={carded}
          enterAfter={reducedMotion ? 0 : Motion.reveal}
        />
      )}

      {error !== '' && (
        <View pointerEvents="none" style={styles.error}>
          <Icon name={IconName.warn} size={ERROR_ICON} color={Color.caution} />
          <Text
            testID="splat-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={styles.errorText}
          >
            {error}
          </Text>
        </View>
      )}
      <ProjectedPartsContext.Provider value={projection}>
        {children}
      </ProjectedPartsContext.Provider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    position: 'absolute',
    top: Space.md,
    left: Space.md,
    right: Space.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Color.lineStrong,
    backgroundColor: Color.surface,
  },
  errorText: { ...Type.footnote, flex: 1, color: Color.text },
});

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { LiquidGlassView } from '@sbaiahmed1/react-native-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callback } from 'react-native-nitro-modules';
import {
  ARPlacementView,
  type ARAssemblyEvent,
  type ARAssemblyPart,
  type ARPlacementEvent,
} from 'react-native-splat';
import V8_CAPTURE from '../../../assets/ar/v8-engine.json';
import { Route, type ScreenProps } from '../../app/routes';
import { IconName } from '../../ui/Icon';
import { Color, Radius, Space, Type } from '../../ui/theme';
import { ARGlassButton } from './ARGlassButton';

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
const SCALE_FACTOR = 1.25;
const DEFAULT_ELEVATION = 0.5;
const MIN_ELEVATION = 0;
const MAX_ELEVATION = 2;
const ELEVATION_STEP = 0.25;
const FOOTER_HEIGHT = 160;
const BATCHES = V8_CAPTURE.assemblyBatches;
const INITIAL_ASSEMBLED_COUNT = BATCHES[0].endPartCount;
const INITIAL_EVENT: ARPlacementEvent = {
  state: 'loading',
  message: 'Preparing the engine and camera.',
  scale: DEFAULT_SCALE,
  placed: false,
};

interface Assembly {
  parts: ARAssemblyPart[];
  assembledCount: number;
  phase: ARAssemblyEvent['phase'];
  requestId: number;
}

const INITIAL_ASSEMBLY: Assembly = {
  parts: [],
  assembledCount: INITIAL_ASSEMBLED_COUNT,
  phase: 'idle',
  requestId: 0,
};

function sameParts(before: ARAssemblyPart[], after: ARAssemblyPart[]) {
  return (
    before.length === after.length &&
    before.every(
      (part, index) =>
        part.id === after[index].id && part.label === after[index].label,
    )
  );
}

export function ARAssemblyScreen({
  navigation,
}: ScreenProps<typeof Route.assembly>) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [event, setEvent] = useState(INITIAL_EVENT);
  const [assembly, setAssembly] = useState(INITIAL_ASSEMBLY);
  const assemblyRef = useRef(INITIAL_ASSEMBLY);
  const partsRef = useRef<ARAssemblyPart[]>([]);
  const [command, setCommand] = useState({
    step: INITIAL_ASSEMBLED_COUNT,
    request: 0,
    exploded: true,
  });
  const commandRef = useRef(command);
  const [activeBatch, setActiveBatch] = useState<number | null>(null);
  const exploded = command.exploded;
  const [menuOpen, setMenuOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const animationInFlight = useRef(false);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [elevation, setElevation] = useState(DEFAULT_ELEVATION);
  const [scaleRequest, setScaleRequest] = useState(0);
  const [placementRequest, setPlacementRequest] = useState(0);
  const [resetRequest, setResetRequest] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  const clearAnimation = useCallback(() => {
    animationInFlight.current = false;
    setAnimating(false);
    setActiveBatch(null);
  }, []);
  const issueCommand = (
    step: number,
    preview: boolean,
    batch: number | null,
    interrupt = false,
  ) => {
    // Wait for the current command to start before accepting another skip.
    if (animationInFlight.current && !interrupt) return;
    if (
      interrupt &&
      (assemblyRef.current.phase !== 'assembling' ||
        assemblyRef.current.requestId !== commandRef.current.request)
    )
      return;
    animationInFlight.current = true;
    setAnimating(true);
    setActiveBatch(batch);
    const next = {
      step,
      request: commandRef.current.request + 1,
      exploded: preview,
    };
    commandRef.current = next;
    setCommand(next);
  };
  const receivePlacement = useCallback((next: ARPlacementEvent) => {
    setEvent(next);
    setScale(next.scale);
  }, []);
  const receiveAssembly = useCallback(
    (next: ARAssemblyEvent) => {
      if (next.requestId !== commandRef.current.request) return;
      const freshHierarchy = !sameParts(partsRef.current, next.parts);
      partsRef.current = next.parts;
      if (
        next.phase === 'idle' &&
        (animationInFlight.current || freshHierarchy)
      ) {
        const settled = { ...commandRef.current, step: next.assembledCount };
        commandRef.current = settled;
        setCommand(settled);
      }
      assemblyRef.current = next;
      setAssembly(next);
      if (next.phase === 'idle') clearAnimation();
      else {
        animationInFlight.current = true;
        setAnimating(true);
      }
    },
    [clearAnimation],
  );
  const onPlacementChanged = useMemo(
    () =>
      callback((next: ARPlacementEvent) => {
        if (attemptRef.current === attempt) receivePlacement(next);
      }),
    [attempt, receivePlacement],
  );
  const onAssemblyChanged = useMemo(
    () =>
      callback((next: ARAssemblyEvent) => {
        if (attemptRef.current === attempt) receiveAssembly(next);
      }),
    [attempt, receiveAssembly],
  );
  const supported = Platform.OS === 'ios';
  const state = supported ? event.state : 'unsupported';
  const placed = supported && event.placed;
  const batchCount = BATCHES.filter(
    batch => batch.endPartCount <= assembly.parts.length,
  ).length;
  const completedBatches = BATCHES.slice(0, batchCount).filter(
    batch => batch.endPartCount <= assembly.assembledCount,
  ).length;
  const displayedBatch = activeBatch ?? completedBatches;
  const upcomingBatch = BATCHES[displayedBatch];
  const complete =
    batchCount > 0 &&
    assembly.assembledCount === assembly.parts.length &&
    !animating;
  const canAssemble = placed && state === 'placed' && batchCount > 0;
  const canAnimate = canAssemble && !animating;
  const canStep = canAnimate && exploded;
  const canSkip =
    canAssemble &&
    exploded &&
    animating &&
    assembly.phase === 'assembling' &&
    assembly.requestId === command.request &&
    activeBatch !== null;
  const canResize =
    !animating && ['ready', 'placed', 'searching'].includes(state);
  const resize = (next: number) => {
    if (canResize) {
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
      setScaleRequest(current => current + 1);
    }
  };
  const moveBatch = (direction: number) => {
    if (direction > 0 && canSkip) {
      const currentBatch = BATCHES.findIndex(
        batch => batch.endPartCount === commandRef.current.step,
      );
      if (currentBatch < 0) return;
      const nextBatch = Math.min(currentBatch + 1, batchCount - 1);
      issueCommand(BATCHES[nextBatch].endPartCount, true, nextBatch, true);
      return;
    }
    if (!canStep) return;
    const prefix = assembly.assembledCount;
    const previousBoundary =
      completedBatches === 0 ? 0 : BATCHES[completedBatches - 1].endPartCount;
    if (direction > 0 && completedBatches < batchCount) {
      issueCommand(
        BATCHES[completedBatches].endPartCount,
        true,
        completedBatches,
      );
    } else if (direction < 0 && prefix > INITIAL_ASSEMBLED_COUNT) {
      const target =
        prefix > previousBoundary
          ? previousBoundary
          : completedBatches > 1
          ? BATCHES[completedBatches - 2].endPartCount
          : INITIAL_ASSEMBLED_COUNT;
      issueCommand(
        Math.max(INITIAL_ASSEMBLED_COUNT, target),
        true,
        prefix > previousBoundary ? completedBatches : completedBatches - 1,
      );
    }
  };
  const changePreview = () => {
    if (canAnimate) issueCommand(assembly.assembledCount, !exploded, null);
  };
  const retry = () => {
    clearAnimation();
    setEvent(INITIAL_EVENT);
    partsRef.current = [];
    setAssembly(INITIAL_ASSEMBLY);
    assemblyRef.current = INITIAL_ASSEMBLY;
    const initialCommand = {
      step: INITIAL_ASSEMBLED_COUNT,
      request: 0,
      exploded: true,
    };
    commandRef.current = initialCommand;
    setCommand(initialCommand);
    setMenuOpen(false);
    setScale(DEFAULT_SCALE);
    setElevation(DEFAULT_ELEVATION);
    setScaleRequest(0);
    setPlacementRequest(0);
    setResetRequest(0);
    attemptRef.current += 1;
    setAttempt(attemptRef.current);
  };
  const openSettings = () => {
    Linking.openSettings().catch(() =>
      setEvent(current => ({
        ...current,
        state: 'error',
        message: 'Enable camera access for Field Guide in Settings.',
      })),
    );
  };
  let primaryLabel = 'Preparing AR';
  let primaryIcon: IconName = IconName.next;
  let primaryEnabled = false;
  let primaryAction = () => {};
  if (state === 'permission-denied') {
    primaryLabel = 'Camera settings';
    primaryIcon = IconName.camera;
    primaryEnabled = true;
    primaryAction = openSettings;
  } else if (state === 'error') {
    primaryLabel = 'Try again';
    primaryIcon = IconName.repeat;
    primaryEnabled = true;
    primaryAction = retry;
  } else if (state === 'unsupported') {
    primaryLabel = 'AR unavailable';
  } else if (state === 'requesting-permission') {
    primaryLabel = 'Camera access';
  } else if (state === 'limited' || state === 'paused') {
    primaryLabel = state === 'limited' ? 'Restore tracking' : 'AR paused';
  } else if (!placed && ['searching', 'ready'].includes(state)) {
    primaryLabel = state === 'ready' ? 'Place engine' : 'Find a flat surface';
    primaryIcon = IconName.frame;
    primaryEnabled = state === 'ready';
    primaryAction = () => setPlacementRequest(current => current + 1);
  } else if (canAssemble) {
    primaryLabel = !exploded
      ? 'Continue tour'
      : complete
      ? 'Assembled'
      : 'Next step';
    primaryIcon = complete && exploded ? IconName.check : IconName.next;
    primaryEnabled = canSkip || (canAnimate && (!exploded || !complete));
    primaryAction = !exploded ? changePreview : () => moveBatch(1);
  }
  const showMessage = ['unsupported', 'error', 'limited'].includes(state);

  return (
    <View testID="ar-assembly-screen" style={styles.root}>
      {supported && (
        <ARPlacementView
          key={attempt}
          testID="ar-assembly-camera"
          style={StyleSheet.absoluteFill}
          modelPath={V8_CAPTURE.modelPath}
          scale={scale}
          elevation={elevation}
          scaleRequest={scaleRequest}
          placementRequest={placementRequest}
          resetRequest={resetRequest}
          assemblyStep={command.step}
          assemblyRequest={command.request}
          assemblyOrder={V8_CAPTURE.assemblyOrder}
          exploded={exploded}
          onPlacementChanged={onPlacementChanged}
          onAssemblyChanged={onAssemblyChanged}
        />
      )}
      <View
        pointerEvents="box-none"
        style={[styles.topControls, { top: insets.top + Space.sm }]}
      >
        <ARGlassButton
          testID="ar-assembly-back"
          icon={IconName.back}
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
        />
        <ARGlassButton
          testID="ar-assembly-controls"
          icon={menuOpen ? IconName.close : IconName.layers}
          accessibilityLabel={menuOpen ? 'Close controls' : 'Assembly controls'}
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen(current => !current)}
        />
      </View>
      {!placed && ['searching', 'ready'].includes(state) && (
        <View pointerEvents="none" style={styles.targetArea}>
          <View
            style={[styles.target, state === 'ready' && styles.targetReady]}
          />
        </View>
      )}
      {menuOpen && (
        <LiquidGlassView
          glassType="clear"
          glassTintColor="transparent"
          isInteractive={false}
          reducedTransparencyFallbackColor={Color.raised}
          style={[
            styles.menu,
            {
              top: insets.top + 64,
              maxHeight: Math.max(
                140,
                height - insets.top - insets.bottom - FOOTER_HEIGHT,
              ),
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.menuContent}>
            {placed && (
              <>
                <Text style={styles.menuLabel}>
                  {animating && activeBatch !== null
                    ? activeBatch + 1
                    : completedBatches}{' '}
                  / {batchCount} steps
                </Text>
                <ARGlassButton
                  testID="ar-assembly-previous"
                  label="Previous step"
                  icon={IconName.back}
                  accessibilityLabel="Separate the previous group of parts"
                  disabled={
                    !canStep ||
                    assembly.assembledCount <= INITIAL_ASSEMBLED_COUNT
                  }
                  onPress={() => moveBatch(-1)}
                />
                <ARGlassButton
                  testID="ar-assembly-preview"
                  label={exploded ? 'Assembled view' : 'Exploded view'}
                  icon={IconName.layers}
                  accessibilityLabel={
                    exploded ? 'Preview assembled engine' : 'Return to the tour'
                  }
                  disabled={!canAnimate}
                  onPress={changePreview}
                />
                <ARGlassButton
                  testID="ar-assembly-restart"
                  label="Restart"
                  icon={IconName.repeat}
                  accessibilityLabel="Restart assembly"
                  disabled={
                    !canAnimate ||
                    (assembly.assembledCount <= INITIAL_ASSEMBLED_COUNT &&
                      exploded)
                  }
                  onPress={() => {
                    if (canAnimate) {
                      issueCommand(INITIAL_ASSEMBLED_COUNT, true, null);
                    }
                  }}
                />
              </>
            )}
            {['searching', 'ready', 'placed'].includes(state) && (
              <>
                <Text style={styles.menuLabel}>Relative size</Text>
                <View style={styles.scaleRow}>
                  <ARGlassButton
                    testID="ar-assembly-smaller"
                    label="Smaller"
                    accessibilityLabel="Reduce relative model size"
                    disabled={!canResize || event.scale <= MIN_SCALE}
                    onPress={() => resize(event.scale / SCALE_FACTOR)}
                    style={styles.scaleButton}
                  />
                  <Text style={styles.scale}>
                    {Math.round(event.scale * 100)}%
                  </Text>
                  <ARGlassButton
                    testID="ar-assembly-larger"
                    label="Larger"
                    accessibilityLabel="Increase relative model size"
                    disabled={!canResize || event.scale >= MAX_SCALE}
                    onPress={() => resize(event.scale * SCALE_FACTOR)}
                    style={styles.scaleButton}
                  />
                </View>
                <Text style={styles.menuLabel}>Height</Text>
                <View style={styles.scaleRow}>
                  <ARGlassButton
                    testID="ar-assembly-lower"
                    label="Lower"
                    accessibilityLabel="Lower the engine by 25 centimeters"
                    disabled={!canResize || elevation <= MIN_ELEVATION}
                    onPress={() =>
                      setElevation(current =>
                        Math.max(MIN_ELEVATION, current - ELEVATION_STEP),
                      )
                    }
                    style={styles.scaleButton}
                  />
                  <Text style={styles.scale}>{elevation.toFixed(2)} m</Text>
                  <ARGlassButton
                    testID="ar-assembly-higher"
                    label="Higher"
                    accessibilityLabel="Raise the engine by 25 centimeters"
                    disabled={!canResize || elevation >= MAX_ELEVATION}
                    onPress={() =>
                      setElevation(current =>
                        Math.min(MAX_ELEVATION, current + ELEVATION_STEP),
                      )
                    }
                    style={styles.scaleButton}
                  />
                </View>
              </>
            )}
            {placed && (
              <ARGlassButton
                testID="ar-assembly-relocate"
                label="Move engine"
                icon={IconName.frame}
                accessibilityLabel="Place the engine on another surface"
                disabled={animating}
                onPress={() => {
                  if (!animationInFlight.current) {
                    setMenuOpen(false);
                    setEvent(current => ({
                      ...current,
                      state: 'searching',
                      placed: false,
                    }));
                    setResetRequest(current => current + 1);
                  }
                }}
              />
            )}
            <Text style={styles.menuNote}>
              Visual assembly tour. Mechanical order pending review.
            </Text>
          </ScrollView>
        </LiquidGlassView>
      )}
      <View
        pointerEvents="box-none"
        style={[styles.footer, { bottom: insets.bottom + Space.sm }]}
      >
        {showMessage && (
          <Text numberOfLines={2} style={styles.floatingText}>
            {state === 'unsupported'
              ? 'Use a physical iPhone or iPad.'
              : event.message}
          </Text>
        )}
        {canAssemble && exploded && !complete && (
          <Text style={styles.floatingText} numberOfLines={1}>
            {upcomingBatch?.label}
          </Text>
        )}
        <Text testID="ar-assembly-credit" style={styles.credit}>
          little.bucket / CC BY-NC 4.0
        </Text>
        <ARGlassButton
          testID="ar-assembly-next"
          label={primaryLabel}
          detail={
            canAssemble && exploded && !complete
              ? `${displayedBatch + 1}/${batchCount}`
              : undefined
          }
          icon={primaryIcon}
          accessibilityLabel={
            canSkip
              ? 'Finish this step and start the next'
              : canStep && !complete
              ? `Next step: ${upcomingBatch?.label}`
              : primaryLabel
          }
          accessibilityState={{ busy: animating }}
          disabled={!primaryEnabled}
          onPress={primaryAction}
          style={styles.primary}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Color.black },
  topControls: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  targetArea: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  target: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: Color.text,
    borderRadius: Radius.round,
  },
  targetReady: { borderColor: Color.accent },
  menu: { position: 'absolute', right: Space.lg, width: 270, borderRadius: 24 },
  menuContent: { padding: Space.md, gap: Space.sm },
  menuLabel: { ...Type.label, color: Color.text, textAlign: 'center' },
  menuNote: { ...Type.caption, color: Color.text, textAlign: 'center' },
  scaleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  scaleButton: { flex: 1 },
  scale: { ...Type.data, color: Color.text, minWidth: 38, textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    alignItems: 'center',
    gap: Space.sm,
  },
  floatingText: {
    ...Type.footnote,
    color: Color.text,
    textAlign: 'center',
    textShadowColor: Color.black,
    textShadowRadius: 4,
  },
  credit: {
    ...Type.caption,
    color: Color.text,
    textAlign: 'center',
    textShadowColor: Color.black,
    textShadowRadius: 4,
  },
  primary: { minWidth: 180, maxWidth: '100%' },
});

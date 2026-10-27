import { useMemo } from 'react';
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
import type { ARAssemblyEvent, ARPlacementEvent } from 'react-native-splat';
import { ARPlacementView } from 'react-native-splat';
import { offersAssembly } from '../domain/availability';
import { SizeLimits } from '../domain/assemblySession';
import {
  assemblyTourFor,
  PrimaryAction,
  TourIcon,
  type TourMove,
} from '../domain/assemblyTour';
import { useAssemblySession } from '../state/assemblyHooks';
import V8_CAPTURE from '../../../../assets/ar/v8-engine.json';
import { IconName } from '../../../ui/Icon';
import { Color, Radius, Space, Type } from '../../../ui/theme';
import { ARGlassButton } from './ARGlassButton';

const FOOTER_HEIGHT = 160;
const BATCHES = V8_CAPTURE.assemblyBatches;

const TOUR_ICON: Record<TourIcon, IconName> = {
  [TourIcon.next]: IconName.next,
  [TourIcon.camera]: IconName.camera,
  [TourIcon.repeat]: IconName.repeat,
  [TourIcon.frame]: IconName.frame,
  [TourIcon.check]: IconName.check,
};

export function ARAssemblyScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const session = useAssemblySession(BATCHES);
  const {
    event,
    command,
    menuOpen,
    animating,
    scale,
    elevation,
    scaleRequest,
    placementRequest,
    resetRequest,
    attempt,
    issue,
    receivePlacement,
    receiveAssembly,
  } = session;
  // Each attempt mounts a new native view, so its callbacks carry the attempt they belong to.
  const onPlacementChanged = useMemo(
    () => callback((next: ARPlacementEvent) => receivePlacement(attempt, next)),
    [attempt, receivePlacement],
  );
  const onAssemblyChanged = useMemo(
    () => callback((next: ARAssemblyEvent) => receiveAssembly(attempt, next)),
    [attempt, receiveAssembly],
  );
  const supported = offersAssembly(Platform.OS);
  const tour = assemblyTourFor(BATCHES, session, supported);
  const { state, placed, exploded, primary } = tour;
  const resize = (next: number) => {
    if (tour.canResize) {
      session.resize(next);
    }
  };
  const openSettings = () => {
    Linking.openSettings().catch(session.settingsFailed);
  };
  // A move the tour does not offer right now leaves the press without effect.
  const run = (move: TourMove | null) => {
    if (move) {
      issue(move);
    }
  };
  const primaryAction = () => {
    switch (primary.action) {
      case PrimaryAction.settings:
        openSettings();
        break;
      case PrimaryAction.retry:
        session.retry();
        break;
      case PrimaryAction.place:
        session.requestPlacement();
        break;
      case PrimaryAction.preview:
        run(tour.preview);
        break;
      case PrimaryAction.next:
        run(tour.next);
        break;
    }
  };

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
          onPress={onBack}
        />
        <ARGlassButton
          testID="ar-assembly-controls"
          icon={menuOpen ? IconName.close : IconName.layers}
          accessibilityLabel={menuOpen ? 'Close controls' : 'Assembly controls'}
          accessibilityState={{ expanded: menuOpen }}
          onPress={session.toggleMenu}
        />
      </View>
      {tour.targeting && (
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
                  {tour.menuStep} / {tour.batchCount} steps
                </Text>
                <ARGlassButton
                  testID="ar-assembly-previous"
                  label="Previous step"
                  icon={IconName.back}
                  accessibilityLabel="Separate the previous group of parts"
                  disabled={tour.previous === null}
                  onPress={() => run(tour.previous)}
                />
                <ARGlassButton
                  testID="ar-assembly-preview"
                  label={exploded ? 'Assembled view' : 'Exploded view'}
                  icon={IconName.layers}
                  accessibilityLabel={
                    exploded ? 'Preview assembled engine' : 'Return to the tour'
                  }
                  disabled={tour.preview === null}
                  onPress={() => run(tour.preview)}
                />
                <ARGlassButton
                  testID="ar-assembly-restart"
                  label="Restart"
                  icon={IconName.repeat}
                  accessibilityLabel="Restart assembly"
                  disabled={!tour.canRestart}
                  onPress={() => run(tour.restart)}
                />
              </>
            )}
            {tour.sizing && (
              <>
                <Text style={styles.menuLabel}>Relative size</Text>
                <View style={styles.scaleRow}>
                  <ARGlassButton
                    testID="ar-assembly-smaller"
                    label="Smaller"
                    accessibilityLabel="Reduce relative model size"
                    disabled={!tour.canShrink}
                    onPress={() => resize(event.scale / SizeLimits.scaleFactor)}
                    style={styles.scaleButton}
                  />
                  <Text style={styles.scale}>
                    {Math.round(event.scale * 100)}%
                  </Text>
                  <ARGlassButton
                    testID="ar-assembly-larger"
                    label="Larger"
                    accessibilityLabel="Increase relative model size"
                    disabled={!tour.canGrow}
                    onPress={() => resize(event.scale * SizeLimits.scaleFactor)}
                    style={styles.scaleButton}
                  />
                </View>
                <Text style={styles.menuLabel}>Height</Text>
                <View style={styles.scaleRow}>
                  <ARGlassButton
                    testID="ar-assembly-lower"
                    label="Lower"
                    accessibilityLabel="Lower the engine by 25 centimeters"
                    disabled={!tour.canLower}
                    onPress={session.lower}
                    style={styles.scaleButton}
                  />
                  <Text style={styles.scale}>{elevation.toFixed(2)} m</Text>
                  <ARGlassButton
                    testID="ar-assembly-higher"
                    label="Higher"
                    accessibilityLabel="Raise the engine by 25 centimeters"
                    disabled={!tour.canRaise}
                    onPress={session.raise}
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
                onPress={session.relocate}
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
        {tour.showsMessage && (
          <Text numberOfLines={2} style={styles.floatingText}>
            {state === 'unsupported'
              ? 'Use a physical iPhone or iPad.'
              : event.message}
          </Text>
        )}
        {tour.inProgress && (
          <Text style={styles.floatingText} numberOfLines={1}>
            {tour.upcomingLabel}
          </Text>
        )}
        <Text testID="ar-assembly-credit" style={styles.credit}>
          little.bucket / CC BY-NC 4.0
        </Text>
        <ARGlassButton
          testID="ar-assembly-next"
          label={primary.label}
          detail={primary.detail}
          icon={TOUR_ICON[primary.icon]}
          accessibilityLabel={primary.accessibilityLabel}
          accessibilityState={{ busy: animating }}
          disabled={!primary.enabled}
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

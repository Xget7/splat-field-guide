# Nitro Views spike on React Native 0.87.1

Status: completed simulator spike, 2026-09-30; accepted in [ADR 0005](../adr/0005-nitro-views.md), with physical-device criteria still pending and the spike screen removed.

Decides [ADR 0005](../adr/0005-nitro-views.md).
Result: a Nitro HybridView works on iOS, all three criteria pass on the simulator; the physical iPhone run is still pending (phone locked).

## What was built

- Library skeleton [`packages/react-native-splat`](../../packages/react-native-splat): Nitro spec in `src/`, Swift in `ios/`, generated code in `nitrogen/generated` (committed, as Nitro's template does).
- `SplatView` (Swift HybridView): a `CAMetalLayer` view and one `SplatRenderThread` per view that clears the drawable.
  `orbit(dAzimuth, dElevation)` only enqueues (hue shifts by azimuth), `highlight` is read by the render thread (tints the clear colour), `onReady` fires from the render thread after the first frame.
- `SplatDiagnostics` (second HybridObject): live views, layers, render threads, thread starts and stops, `orbit` calls by thread.
- Spike screen in `apps/field-guide` (commit d1e22e8, removed once the guide screen replaced it): full-screen view, `usePanGesture` worklet calling `orbit`, "Mount x100" button (`mountStress.ts`), `onReady` counter.

## Versions

react-native 0.87.1, react 19.2.3, react-native-nitro-modules and nitrogen 0.37.1, react-native-reanimated 4.7.0 (peer range 0.86 - 0.88), react-native-worklets 0.13.0, react-native-gesture-handler 3.3.0 (v3 hook API), Xcode 27.0, iOS 26.5.

## Criteria

All rows come from the iOS simulator (iPhone 17 Pro, iOS 26.5, Debug) unless stated.

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | 100 mount/unmount cycles, no crash, no growth | Pass | Report on screen: `PASS 100 cycles: started 100, stopped 100, peak threads 1`; os_log had 202 `render thread start` and 201 `render thread stop` (one view live) after two runs; live views/layers back at baseline after Hermes collection. |
| 2 | `orbit` from a gesture worklet on the UI thread | Pass | Native log `orbit call #1 on thread=main isMain=true` from a real pan; counters `main 4, other 0`; separate JS thread with no hop; clear-colour hue visibly changed. |
| 3 | `onReady` from the render thread reaches JS | Pass | Native log `onReady fired on thread=splat.render`; the screen counter showed `onReady calls: 1` on mount and `100` after the stress run. |

Physical iPhone 17 Pro: the Debug build signed, built and installed, but launch failed with "device was not, or could not be, unlocked".
The three criteria are therefore not yet verified on the device.

## Findings the engine work must know

- Native views are freed only when Hermes collects the JS wrapper of the hybrid object.
  Before forcing `gc()`, 100 unmounted views and layers were still alive; two `gc()` calls brought them to 1 (the one held by React state).
  Render threads do not have this problem because `onDropView` stops them.
  Free GPU buffers and the cloud in `onDropView`, never in `deinit`.
- The pod name must equal `iosModuleName` (`ReactNativeSplat`), or the generated Swift header is not found.
- Callback props and `hybridRef` must be wrapped in `callback(...)`; arrays are compared by identity, so pass a stable `highlight` array.
- A hybrid object captured in a Reanimated worklet is serialised by Nitro's Worklets support; no manual `box` is needed.
- The Xcode 27 simulator SDK has no `MTLDrawable.addPresentedHandler`; the simulator uses the command buffer completed handler, the device uses the presented handler (device path compiled, not run).
- The app links the library with `file:`; Metro needs `watchFolders` and must block the library's own `node_modules`, or react-native is loaded twice ([`metro.config.js`](../../apps/field-guide/metro.config.js)).
- Engine integration now uses `sfg.h` from a separately built, source-fingerprinted XCFramework before CocoaPods vendors it ([ADR 0014](../adr/0014-bare-react-native-with-nitro-packages.md)).
  `engine/` is excluded from nitrogen and eslint in `nitro.json` and `.eslintrc.js`.
- Android was not touched: `nitro.json` autolinks iOS only.

## Recommendation

Accept Nitro Views for iOS.
Re-run the three criteria on the iPhone before the Android spike; if the device disagrees, reopen the ADR.

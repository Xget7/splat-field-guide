# React Native native 3D library: exposure, structure, tooling

Date: 2026-09-29.
Sources are primary only: library source on GitHub (cloned at main on this date), official docs, release notes.
Versions checked on npm today: react-native 0.87.1 (released 2026-08-26), reanimated 4.7.0, worklets 0.13.0, gesture-handler 3.3.0, nitro-modules 0.37.1, skia 2.13.1, vision-camera 5.2.3, filament 1.11.0, builder-bob 0.43.1, create-react-native-library 0.63.1.
Items marked (unverified) could not be confirmed against a primary source.

## Corrections to the brief

Fabric codegen commands DO accept arrays, but only arrays of primitives.
Accepted command parameter types are RootTag, boolean, Int32, Double, Float, string, and Array/ReadOnlyArray of those.
Any object element type degrades to `MixedTypeAnnotation`, which the generators emit as untyped ReadableMap or NSArray.
Any other parameter type (struct, ArrayBuffer, typed array) throws "Unsupported param type" at codegen time.
Source: https://github.com/facebook/react-native/blob/main/packages/react-native-codegen/src/parsers/typescript/components/commands.js
Commands reach iOS as `handleCommand:(NSString*) args:(NSArray*)`, so the payload is untyped at the native boundary.
Source: https://github.com/facebook/react-native/blob/main/packages/react-native/React/Fabric/Mounting/RCTComponentViewProtocol.h
Fabric event payloads and props accept typed arrays of primitives and nested object literals.
Source (events): https://github.com/facebook/react-native/blob/main/packages/react-native-codegen/src/parsers/typescript/components/events.js
`ArrayBuffer` exists in TurboModule codegen only.
It maps to `jsi::ArrayBuffer` in C++ modules; platform-native modules copy ArrayBuffer arguments and return them zero-copy from sync methods; `Promise<ArrayBuffer>` is rejected at codegen.
Sources: https://github.com/facebook/react-native/blob/main/packages/react-native-codegen/src/generators/modules/Utils.js and https://github.com/facebook/react-native/blob/main/packages/react-native-codegen/src/generators/modules/GenerateModuleH.js
None of the four reference libraries below builds its big third-party GPU dependency from source at app build time (Skia, Dawn, Filament ship prebuilt binaries).
Only their own glue C++ is compiled from source by podspec/CMake.
Our situation (compile the whole engine core from source) is therefore closer to their glue layer than to their third-party layer.
None of their example apps is on RN 0.87 yet (webgpu 0.81.4, skia 0.83.1, nitro and vision-camera 0.85.3), so RN 0.87 compatibility of each is (unverified) by them.
Sources: https://github.com/wcandillon/react-native-webgpu/blob/main/apps/example/package.json, https://github.com/Shopify/react-native-skia/blob/main/apps/example/package.json, https://github.com/margelo/nitro/blob/main/apps/example/package.json

## 1. Exposure mechanism compared

RN 0.87 context: Strict TypeScript API is now default, SwiftPM is experimental and additive, CocoaPods remains the default and supported path, AGP 9 and Kotlin 2.0+ are required.
Source: https://github.com/facebook/react-native-website/blob/main/website/blog/2026-08-11-react-native-0.87.mdx (published at https://reactnative.dev/blog/2026/08/11/react-native-0.87).

### (a) Fabric native component with codegen specs

- Boundary types: props and event payloads take primitives, nested object literals, arrays of these; commands take primitives and primitive arrays only (see corrections).
- To send a struct or buffer through a command you flatten to scalars, JSON-encode into a string, or move the data into a revisioned prop.
- Sync vs async: commands are fire-and-forget `void`; there is no return value and no sync read path.
  Source: command schema always returns `VoidTypeAnnotation`, in commands.js above.
- Per-frame from render thread: events go through `EventQueue`, callable from any thread.
  `enqueueUniqueEvent` drops the previous queued event of the same type and target, which is a built-in latest-wins coalescer.
  Source: https://github.com/facebook/react-native/blob/main/packages/react-native/ReactCommon/react/renderer/core/EventQueue.h
  Whether generated emitters use the unique variant for a given event is (unverified); the generated `onX` emitters call `dispatchEvent`, so assume no coalescing unless you emit yourself.
- View lifecycle: iOS `prepareForRecycle` is "called right after the component view is moved to a recycle pool" and the receiver "must reset any local state and release associated non-reusable resources".
  Source: https://github.com/facebook/react-native/blob/main/packages/react-native/React/Fabric/Mounting/RCTComponentViewProtocol.h
  Android `ViewManager.onDropViewInstance` runs on detach and drives `prepareToRecycleView`.
  Source: https://github.com/facebook/react-native/blob/main/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ViewManager.java
  Our existing package already handles both (`prepareForRecycle`, `invalidate`, `onDropViewInstance`) in SplatKit `packages/react-native-splatkit`.
- Threading of renderer: UI thread is the only thread that manipulates host views; JS thread runs render and layout.
  Source: https://github.com/facebook/react-native-website/blob/main/website/architecture/threading-model.md
- Build with shared C++: codegen generates the C++ props, events and component descriptors; the view class is ObjC++ (iOS) and Kotlin plus JNI (Android).
  Autolinking needs `codegenConfig` plus a podspec and a gradle module.
- Maturity: core-owned, stable API.

### (b) Nitro Modules and Nitro Views

- A Hybrid View is a Hybrid Object with a `view` member; one Hybrid Object per mounted view; backed by a C++ ShadowNode; requires RN 0.78+ and New Architecture.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/guides/view-components.md
- Boundary types: custom structs (interfaces), enums, arrays, `ArrayBuffer` (zero-copy), promises, callbacks, even other Hybrid Objects as props.
  Sources: https://github.com/margelo/nitro/blob/main/docs/docs/guides/view-components.md and https://github.com/margelo/nitro/blob/main/docs/docs/types/array-buffers.md
- ArrayBuffer ownership: a native-created buffer is owning and safe to keep across threads; a JS-created buffer is non-owning and valid only until the sync call returns, so copy it if you need it later.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/types/array-buffers.md
- Sync vs async: every method is synchronous on the calling JS thread by default; return a `Promise` to go async.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/guides/sync-vs-async.md
- Any runtime: sync methods work on the UI runtime and other worklet runtimes (`runOnUI(() => { 'worklet'; math.add(5, 3) })`); async APIs (promises, callbacks) need a `Dispatcher` for that runtime.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/guides/worklets.md
  Reanimated preserves `jsi::NativeState` when serializing, which is what makes a Hybrid Object capturable in a worklet.
  Source: https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-worklets/docs/memory/createSerializable.mdx
- Callbacks: kept as strong refs, callable many times from native, so an event is just a stored function.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/types/callbacks.md
  Callback props on a view must be wrapped with `callback(fn)` because RN core converts bare functions to a boolean; upstream fix is pending.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/guides/view-components.md
- Props threading: props set via React arrive on the UI thread; props set through `hybridRef` may arrive on the JS thread, so thread-safety is the implementer's job; `beforeUpdate()` and `afterUpdate()` batch prop changes.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/guides/view-components.md
- Recycling: implement `RecyclableView.prepareForRecycle()` and reset state.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/guides/view-components.md
- Build: `nitro.json` autolinking plus `nitrogen` codegen; generated C++/Swift/Kotlin is committed in VisionCamera and shipped in the npm package.
  Sources: https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera/nitro.json and its `files` list in package.json.
  iOS view class is Swift (`var view: UIView`), Android is Kotlin (`val view: View`), Android needs a registered generated view manager.
  Hybrid Objects (not the view class) can be implemented directly in C++ (`cpp` language in `nitro.json`).
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/getting-started/configuration-nitro-json.md
- Maturity: pre-1.0 (0.37.1 today), Nitro's own docs claim large production use (vendor claim).
  VisionCamera 5.2.3 (9.6k stars) builds its `PreviewView` as a Nitro View, which is the strongest independent evidence for GPU-ish views.
  Source: https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera/src/specs/views/PreviewView.nitro.ts
- Speed claim (100k calls: Expo 435ms, TurboModule 116ms, Nitro 7ms) is Nitro's own benchmark of trivial calls; do not treat it as a real-world number.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/resources/comparison.md

### (c) C++ TurboModules and pure JSI HostObjects

- Pure C++ TurboModule: one spec file, codegen scaffolding, C++ implementation shared by both platforms.
  Source: https://github.com/facebook/react-native-website/blob/main/website/versioned_docs/version-0.87/the-new-architecture/pure-cxx-modules.md
- Libraries can autolink C++ modules through `cxxModuleCMakeListsModuleName`, `cxxModuleCMakeListsPath`, `cxxModuleHeaderName` and `cmakeListsPath` in `react-native.config.js`.
  Source: https://github.com/react-native-community/cli/blob/main/docs/dependencies.md
  The bob `cpp` template wires exactly this, but labels the C++ option "Experimental".
  Sources: https://github.com/callstack/react-native-builder-bob/blob/main/packages/create-react-native-library/templates/cpp-library/react-native.config.js and https://github.com/callstack/react-native-builder-bob/blob/main/packages/create-react-native-library/src/prompt.ts
- A module is a singleton with no per-view object; views need a registry keyed by an id.
  Skia and WebGPU do this: Skia's `RNSkiaModule.install` is a blocking synchronous method that installs `global.SkiaViewApi`, and views register by `nativeId`.
  Sources: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/apple/RNSkiaModule.mm and https://github.com/Shopify/react-native-skia/blob/main/packages/skia/src/views/api.ts
  WebGPU's Fabric view takes a JS-minted `contextId` prop to bind a surface to a context.
  Source: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/apple/WebGPUView.mm
- You own lifetime, thread hops (CallInvoker), worklet-runtime safety, and TypeScript typing by hand; ArrayBuffer and typed arrays are easy in JSI.
- Maturity: stable primitives, but a large hand-written surface (Skia and WebGPU each ship tens of C++ files for it).

### (d) Expo Modules API

- Swift and Kotlin DSL: `Function`, `AsyncFunction`, `View`, `Events`, `Prop`, `OnViewDidUpdateProps`, `OnViewDestroys` (Android only).
  Source: https://github.com/expo/expo/blob/main/docs/pages/modules/module-api.mdx
- Structs via `Record`; `Data` and `ByteArray` map to `Uint8Array` (SDK 50+).
  Source: same doc.
- View `AsyncFunction`s attach to the ref and run on the UI thread by default.
  Source: same doc.
- JS-typed values (`JavaScriptValue`) are sync-only; touching them off the JS thread crashes.
  Source: same doc.
- Bare RN apps must install the `expo` package first.
  Source: https://github.com/expo/expo/blob/main/docs/pages/bare/installing-expo-modules.mdx
- C++ core is your problem: expo-gl ships `common/` C++ plus `android/CMakeLists.txt` (GLESv3) and a Swift `GLView`, so it is a template for sharing C++ but it is OpenGL ES, not Metal or Vulkan.
  Sources: https://github.com/expo/expo/tree/main/packages/expo-gl and https://github.com/expo/expo/blob/main/packages/expo-gl/android/CMakeLists.txt
- Maturity: very mature, tracks RN 0.88 rc on main; forces an Expo dependency on every consumer.
  Source: https://github.com/expo/expo/blob/main/packages/expo/bundledNativeModules.json

### Verdict table

| Need | Fabric codegen | Nitro View | C++ TM / JSI | Expo Modules |
| --- | --- | --- | --- | --- |
| Struct in a command | no, flatten | yes | yes | yes (Record) |
| Buffer in a command | no | yes, zero-copy | yes | yes (Uint8Array) |
| Sync read from UI runtime | no | yes | yes | JS thread only |
| Per-view object and lifecycle | component view | one Hybrid Object per view | hand-rolled registry | view class |
| Typed events | codegen, JS thread | typed callbacks | hand-rolled | Events, JS thread |
| Extra dependency | none | nitro-modules, pre-1.0 | none | expo |

Recommendation: Nitro Views, with the Fabric spec kept as a documented fallback.
Reasons: only Nitro gives structs, buffers, sync calls from the UI runtime and per-view lifecycle without a hand-rolled registry.
Risks to gate on a spike: pre-1.0 API churn (pin exact versions), RN 0.87 not yet in Nitro's example apps, Swift-only view class on iOS, wrapped callbacks.

## 2. How the best GPU and 3D libraries are built

### react-native-skia (Shopify)

- Layout: monorepo, `packages/skia/{cpp,apple,android,src}`; shared C++ in `cpp/rnskia` and `cpp/jsi`, Metal in `apple/`, GL in `android/cpp/rnskia-android`.
  Source: https://github.com/Shopify/react-native-skia/tree/main/packages/skia
- Wiring iOS: one podspec, `source_files = apple/** + cpp/**`, vendored Skia xcframeworks copied from npm packages at `pod install`, `install_modules_dependencies(s)`.
  Source: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/react-native-skia.podspec
- Wiring Android: `android/CMakeLists.txt` imports prebuilt `libskia.a`; gradle passes `SKIA_LIBS_PATH`, `REACT_NATIVE_DIR`, `abiFilters(reactNativeArchitectures())`, `ANDROID_STL=c++_shared`, flexible page sizes.
  Sources: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/android/CMakeLists.txt and https://github.com/Shopify/react-native-skia/blob/main/packages/skia/android/build.gradle
- Surface: iOS `CAMetalLayer` (`MetalWindowContext.mm`); Android chooses `SurfaceView` for opaque canvases and `TextureView` for non-opaque, and hands native a `Surface` or `SurfaceTexture`; native wraps `ANativeWindow`.
  Sources: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/android/src/main/java/com/reactnative/skia/SkiaBaseView.java and https://github.com/Shopify/react-native-skia/blob/main/packages/skia/apple/MetalWindowContext.mm
- Threading: `RNSkView::requestRedraw()` coalesces with a flag and renders via `runOnMainThread`.
  In JS, the scene builds an SkPicture and `Reanimated.runOnUI` calls `nativeDrawOnscreen`, so drawing runs on the UI runtime without the JS thread.
  Sources: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/cpp/rnskia/RNSkView.h and https://github.com/Shopify/react-native-skia/blob/main/packages/skia/src/sksg/Container.native.ts
- Imperative API: JSI `global.SkiaViewApi` installed by a sync TurboModule method; codegen used only for the view (`type: "all"`).
  Source: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/package.json
- Tests: jest with image snapshots plus Playwright web tests; lint with cpplint and clang-format targets; turbo orchestrates `build:ios` and `build:android`.
  Sources: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/package.json and https://github.com/Shopify/react-native-skia/blob/main/turbo.json

### react-native-wgpu (wcandillon/react-native-webgpu)

- Layout: `packages/webgpu/{cpp,apple,android,src}`, `cpp/rnwgpu` is the shared API, Dawn prebuilt into `libs/` by `install-dawn`, version pinned by a `dawn` field in package.json (chrome-m154).
  Source: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/package.json
- iOS podspec: `source_files = apple/** + cpp/**`, vendored `libwebgpu_dawn.xcframework`, `USE_HEADERMAP=NO` to stop header leaks between pods; `Package.swift` exists for the new SwiftPM path and the podspec must then compile nothing (`RNWGPU_USE_SPM`).
  Source: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/react-native-webgpu.podspec
- Android: hand-listed sources in `CMakeLists.txt`, `find_package(ReactAndroid)` and `fbjni` via prefab, `NODE_MODULES_DIR` passed from gradle.
  Source: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/android/CMakeLists.txt
- Surface: `MetalView` overriding `layerClass` to `CAMetalLayer`; Android ships `SurfaceView`, `TextureView` and hardware-buffer variants.
  Sources: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/apple/MetalView.mm and https://github.com/wcandillon/react-native-webgpu/tree/main/packages/webgpu/android/src/main/java/com/webgpu
- Threading: devices live on the JS runtime or a worklet runtime; device-lost events reach JS via the registered main `CallInvoker`; worklet-runtime devices are "best-effort" for spontaneous events.
  Source: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/cpp/rnwgpu/RNWebGPUManager.cpp
- Worklet interop: boxing helpers so GPU objects cross into Worklets runtimes.
  Source: same file.
- Tests: E2E on device against a Metro-served Tests screen, snapshot-compared with a Chrome reference run (`test:ref`), plus Node-side runs.
  Source: https://github.com/wcandillon/react-native-webgpu/blob/main/packages/webgpu/CONTRIBUTING.md

### react-native-filament (margelo)

- Layout: `package/{cpp,ios,android}`; `cpp/core` wraps Filament objects as HybridObject-style wrappers; own `cpp/jsi` (pre-Nitro), `cpp/threading` Dispatcher.
  Source: https://github.com/margelo/react-native-filament/tree/main/package/cpp
- Prebuilt Filament and Bullet libs under `ios/libs` and `android/libs`, produced by `scripts/build-filament.sh` or downloaded by `setup-filament-quick.sh`.
  Sources: https://github.com/margelo/react-native-filament/blob/main/package/scripts/setup-filament-quick.sh and its podspec https://github.com/margelo/react-native-filament/blob/main/package/react-native-filament.podspec
- Optional `react-native-worklets-core` detected at `pod install`, sets `HAS_WORKLETS`.
  Source: podspec above.
- Surface and loop: Fabric `FilamentComponent`; `CADisplayLink` listener on iOS and a Java `FilamentChoreographer` on Android; README claims rendering "on separate Threads".
  Sources: https://github.com/margelo/react-native-filament/blob/main/package/ios/src/RNFDisplayLinkListener.m and https://github.com/margelo/react-native-filament/blob/main/README.md
- Maturity signal: last commit 2026-05-27, npm 1.11.0; treat as slower moving than Skia.
- Tests: a C++ test HybridObject (`cpp/test`) exercised from JS; no image-snapshot suite seen (unverified beyond that).

### react-native-vision-camera 5 (frame processors and worklets)

- Layout: monorepo of packages; core `react-native-vision-camera` is Nitro (`nitro.json` lists `PreviewView`, `FrameRendererView`, `NativeThreadFactory`); worklets integration is a separate package `react-native-vision-camera-worklets` so the core does not require Worklets.
  Sources: https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera/nitro.json and https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera-worklets/package.json
- Podspec: Swift plus ObjC++ plus C++ globs, `load 'nitrogen/generated/ios/VisionCamera+autolinking.rb'`, `add_nitrogen_files(s)`.
  Source: https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera/VisionCamera.podspec
- PreviewView props include `implementationMode: 'performance' | 'compatible'`; 'performance' uses SurfaceView and "does not support transparency or view layering".
  Source: https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera/src/specs/views/PreviewView.nitro.ts
- Backpressure pattern: `createAsyncRunner` keeps a `createSynchronizable(false)` busy flag, returns false when busy so the caller drops the frame, runs work on a dedicated native thread with its own worklet runtime.
  Source: https://github.com/margelo/react-native-vision-camera/blob/main/packages/react-native-vision-camera-worklets/src/createAsyncRunner.ts
- Object lifetime: `frame.dispose()` releases native buffers eagerly instead of waiting for GC.
  Source: https://github.com/margelo/nitro/blob/main/docs/docs/concepts/hybrid-objects.md

### expo-gl (only where relevant)

- OpenGL ES only, so it is a reference for Expo-module packaging of a C++ core (`common/`), not for Metal or Vulkan.
  Source: https://github.com/expo/expo/tree/main/packages/expo-gl

### Cross-cutting lessons

- All four keep one shared C++ folder at the package root and reference it from both podspec and CMake via relative paths inside the package.
- All four pass the render surface as a native handle (`CAMetalLayer`, `ANativeWindow` from a `Surface`) and keep GPU calls off the JS thread.
- Android view choice is a prop (`SurfaceView` vs `TextureView`) in Skia and VisionCamera, because SurfaceView cannot be transformed or layered like a normal view.
  SurfaceView is a separate composited layer, placed behind the app UI by default, and the platform advises rendering "from a thread other than the main UI thread".
  Source: https://source.android.com/docs/core/graphics/arch-sv-glsv
- Build-from-source of the whole engine is our differentiator; none of them do it for the GPU dependency.

## 3. Library package structure

- Scaffolder: `create-react-native-library` 0.63.1 offers Turbo module, Fabric view, Nitro module, Nitro view, JS library; languages Kotlin and Swift, Kotlin and ObjC, C++ (Experimental); example app types vanilla, Expo, or Test App.
  Source: https://github.com/callstack/react-native-builder-bob/blob/main/packages/create-react-native-library/src/prompt.ts
- Template `package.json`: `main`/`types`, and `exports` with a custom source condition (`<slug>-source` -> `./src/index.tsx`), `types`, `default` -> `./lib/module/index.js`; `files` allowlist including `android`, `ios`, `cpp`, `nitrogen`, `*.podspec`, `react-native.config.js` and exclusions for build outputs; `prepare: bob build`; `workspaces: ["example"]`; yarn 4.
  Source: https://github.com/callstack/react-native-builder-bob/blob/main/packages/create-react-native-library/templates/common/%24package.json
- Bob targets: `module` with `esm: true`, `typescript` with `tsconfig.build.json`, `codegen` for C++ libraries, and a `custom` target running `nitrogen` for Nitro.
  Source: same file.
- ESM guidance: `moduleResolution: "bundler"`, keep `main` for Metro older than 0.82, `types` for node10 resolution.
  Source: https://github.com/callstack/react-native-builder-bob/blob/main/docs/pages/esm.md
- TypeScript: strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `customConditions` includes the source condition and `react-native-strict-api`.
  Source: https://github.com/callstack/react-native-builder-bob/blob/main/packages/create-react-native-library/templates/common/tsconfig.json
- Optional tool templates: eslint, lefthook, jest, turborepo, release-it, vite (web example).
  Source: https://github.com/callstack/react-native-builder-bob/tree/main/packages/create-react-native-library/templates/tools
- Example app and Metro: template uses `react-native-monorepo-config` `withMetroConfig({root, dirname, conditions:[sourceCondition]})`, and recommends disabling hoisting for the app (yarn `nmHoistingLimits: 'workspaces'`).
  Sources: https://github.com/callstack/react-native-builder-bob/blob/main/packages/create-react-native-library/templates/example-common/example/metro.config.js and https://github.com/satya164/react-native-monorepo-config
- Peer deps: react-native `*` in the template; we should narrow (existing package uses `>=0.87.0 <0.89.0`) and mark `react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler` as optional peers.
  Reanimated 4.7.0 peers: react-native `0.86 - 0.88`, worklets `0.13.x`; worklets 0.13.0 peers react-native `0.86 - 0.88` (npm registry).
- Quality checklist for a high-quality RN native library (engineering judgment, not a spec):
  - Docs: install, minimum versions, one runnable snippet, threading table, error-code table; link contracts rather than duplicate them.
  - Typed events: discriminated unions on `phase`/`kind`; a single event envelope with `requestId` or `revision` so stale results are ignorable (our existing package does this).
  - Error model: stable string `code`, human `message`, never throw across the render thread; sync methods return a result union.
  - Lifecycle: every native object has an owner; `prepareForRecycle`/`onDropViewInstance`/`dispose()` are idempotent; no callbacks after dispose.
  - Dev-mode warnings: `__DEV__`-gated warnings for invalid props, non-worklet callbacks passed to worklet APIs, event rates above budget.
  - Accessibility of the host view: RN documents `accessible`, `accessibilityLabel`, `accessibilityRole`, `accessibilityValue`, `accessibilityActions` with `onAccessibilityAction`; a GPU canvas is opaque to screen readers, so expose a label plus actions (orbit, zoom, reset) and keep part labels as real RN views.
  Source: https://github.com/facebook/react-native-website/blob/main/website/versioned_docs/version-0.87/accessibility.md
  Respect reduced motion: `AccessibilityInfo.isReduceMotionEnabled` in RN, `useReducedMotion` in Reanimated.
  Sources: https://github.com/facebook/react-native-website/blob/main/website/versioned_docs/version-0.87/accessibilityinfo.md and https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-reanimated/docs/guides/accessibility.mdx

## 4. JS to native boundary performance

- Prefer declarative revisioned props for low-rate state and direct sync calls for high-rate input; never route per-frame values through React state.
- Reanimated can call native commands from the UI thread: `dispatchCommand(animatedRef, 'name', args)`.
  Source: https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-reanimated/docs/advanced/dispatchCommand.mdx
  Our existing example already dispatches `setCameraPose` from a `useFrameCallback` worklet (commit 4945e4c).
- Animating a custom prop through Reanimated is NOT a cheap synchronous write: the synchronous prop allowlist contains only style-like names (opacity, colors, borderRadius, transform, ...), so a custom `camera` prop would take the regular Fabric commit path.
  Source: https://github.com/software-mansion/react-native-reanimated/blob/main/packages/react-native-reanimated/Common/cpp/reanimated/Fabric/updates/SynchronousPropNames.h
  That the non-allowlisted path is heavier than a command is my inference from that file, not a documented claim.
  Conclusion: drive the camera with commands or sync method calls, not with animated custom props.
- Gestures: RNGH 3 auto-workletizes callbacks declared inline in the gesture config, they run on the UI runtime when Reanimated is present, `runOnJS: true` moves them to JS, and `SharedValue`s can appear in gesture config without re-rendering.
  Source: https://github.com/software-mansion/react-native-gesture-handler/blob/main/packages/docs-gesture-handler/docs/fundamentals/reanimated-interactions.mdx
  Callbacks wrapped in `useCallback` or defined outside need an explicit `'worklet'` directive (same doc).
- Worklets to JS: `scheduleOnRN(fn, ...args)` runs a function on the RN runtime from any worklet runtime; `runOnUISync` runs a worklet synchronously on the UI runtime.
  Sources: https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-worklets/docs/threading/scheduleOnRN.mdx and https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-worklets/docs/threading/runOnUISync.mdx
- Per-frame overlay data, best pattern: keep it off the JS thread.
  A `useFrameCallback` on the UI runtime reads the camera state through a sync Nitro call into a preallocated buffer and writes shared values that drive `useAnimatedStyle` for labels.
  Source for the frame callback hook: https://github.com/software-mansion/react-native-reanimated/blob/main/docs/docs-reanimated/docs/advanced/useFrameCallback.mdx
  Source for sync calls on the UI runtime: Nitro worklets guide above.
- Fallback when a channel must reach JS: coalesce native-side (latest wins), cap the rate, and drop when the consumer is busy; VisionCamera's `isBusy` synchronizable is the reference pattern.
  Source: createAsyncRunner.ts above.
- Batching: one revisioned request struct per change (world, camera, policy) instead of N scalar commands; Nitro `afterUpdate()` is the natural commit point.
- Avoid re-renders: emit events only for state React renders (phase changes, loaded, errors); keep stats and pose out of props and state.
- Backpressure rules to encode: every high-rate producer has a latest-wins slot, a max rate, and a documented drop policy.

## 5. Monorepo tooling for RN plus native C++

- Workspaces: Skia and WebGPU use yarn workspaces (`packages/*`, `apps/*`) with turbo; Nitro, VisionCamera and Filament use bun workspaces (`bunfig.toml`, `bun.lock`).
  Sources: https://github.com/Shopify/react-native-skia/blob/main/package.json, https://github.com/margelo/nitro/blob/main/package.json and https://github.com/margelo/react-native-vision-camera/blob/main/package.json
- Autolinking: iOS adds every dependency's podspec as a CocoaPods dev pod from its local path, so the library compiles in place from source; Android reads `react-native config` output.
  Source: https://github.com/react-native-community/cli/blob/main/docs/autolinking.md
  A linked (symlinked) package is found because the app lists it in `dependencies`; our example uses `"file:../../packages/react-native-splatkit"`.
- Metro: `watchFolders` must contain linked packages and the workspace root, and symlink targets must also be inside `watchFolders`.
  Source: https://metrobundler.dev/docs/configuration
  Package `exports` are honored by default; custom conditions come from `unstable_conditionNames` (experimental).
  Same source.
  Prefer `react-native-monorepo-config` over hand-written `resolveRequest` (our example hand-pins `react` and `react-native` to avoid two copies).
  Sources: https://github.com/satya164/react-native-monorepo-config and SplatKit `apps/react-native/metro.config.js`
- Skia's example app is a plain workspace app with `makeMetroConfig` from `@rnx-kit/metro-config`.
  Source: https://github.com/Shopify/react-native-skia/blob/main/apps/example/metro.config.js
- Keeping build output out of `node_modules` and the repo: `.cxx` and `build/` land inside the linked package folder by default.
  Redirect with AGP `externalNativeBuild.cmake.buildStagingDirectory` or build the engine into an out-of-tree CMake dir (unverified: I found no doc page or reference repo using `buildStagingDirectory`).
  Our environment note: fresh in-repo CMake configures fail under `~/Documents` in the agent shell, so configure outside the repo (memory file agent-env-cmake-under-documents).
  iOS product output already goes to Xcode DerivedData and `Pods/`, not the package.
- ccache: RN documents it for both platforms and says Android needs only ccache installed; iOS needs `:ccache_enabled => true` in `react_native_post_install` or `USE_CCACHE=1` at `pod install`, which sets CC, CXX, LD, LDPLUSPLUS on every pods-project configuration (so our pod is covered).
  Sources: https://github.com/facebook/react-native-website/blob/main/website/versioned_docs/version-0.87/build-speed.md and https://github.com/facebook/react-native/blob/main/packages/react-native/scripts/cocoapods/utils.rb
  Whether AGP's CMake invocation for a library module picks up ccache without `-DCMAKE_CXX_COMPILER_LAUNCHER=ccache` is (unverified); pass it explicitly in `externalNativeBuild.cmake.arguments`.
  ccache does not cache Metal shader compilation (unverified); we embed shader source, so it does not matter.
- ABI trimming for dev: honor `reactNativeArchitectures` in gradle (Skia and WebGPU do).
  Source: https://github.com/Shopify/react-native-skia/blob/main/packages/skia/android/build.gradle
- SwiftPM (RN 0.87, experimental): consumers need a `Package.swift`; `npx react-native spm scaffold` generates one from a podspec; do not depend on it yet.
  Source: RN 0.87 blog above; WebGPU ships both, see section 2.
- CI: build Android and iOS example apps from turbo tasks with declared inputs (`cpp/**`, `android/**`, `ios/**`), as Skia's `turbo.json` does.
  Source: https://github.com/Shopify/react-native-skia/blob/main/turbo.json

## Unverified summary

- Whether generated Fabric emitters use `enqueueUniqueEvent`.
- Android `buildStagingDirectory` behavior and ccache pickup by AGP for library modules.
- Nitro Views on RN 0.87 (not in any reference example app yet).
- Apple docs for `CAMetalLayer`/`CADisplayLink` (not fetched; behavior taken from Skia, WebGPU and our own code).
- Metal shader handling in pods beyond our existing embed-source approach.
- AGP `shaders {}` DSL applicability to library modules (documented for app modules, page cited: https://developer.android.com/ndk/guides/graphics/shader-compilers).

# Recommendation for our library

## Exposure mechanism

Nitro Views (one `SplatView` Hybrid View) plus one C++ Hybrid Object `SplatEngineHost` only if we need a process-wide singleton (asset cache); start without it.
The shared C++ core stays plain C++ with no Nitro types; Swift and Kotlin view classes are thin adapters that call it through the existing ObjC `SKSplatEngine` and JNI layers.
Fallback: keep the current codegen spec (SplatKit `packages/react-native-splatkit/src/specs/SplatViewNativeComponent.ts`) alive until the Nitro spike passes on RN 0.87 on both platforms.
Spike gate: mount, recycle, unmount 100 times; call a sync method from a Reanimated `useFrameCallback`; fire a callback from the render thread; check no leaks and no callbacks after dispose.

## Package layout

```
splatkit-rn/                      (monorepo root, bun or yarn 4 workspaces, turbo)
  package.json  turbo.json  .yarnrc.yml (nmHoistingLimits: workspaces)
  packages/react-native-splatkit/
    package.json                  exports: source condition, types, default -> lib/module
    nitro.json  nitrogen/generated/   (committed, shipped)
    SplatKitReactNative.podspec  react-native.config.js
    cpp/                          shared core: load, sort, camera, pick, LOD (no RN includes)
      engine/  include/  shaders/ (Metal + GLSL sources, embedded at build)
    ios/                          Swift HybridSplatView, ObjC++ Metal backend, CAMetalLayer view
    android/                      Kotlin HybridSplatView + package, JNI, Vulkan backend
      CMakeLists.txt  build.gradle  src/main/{java,cpp,shaders}
    src/                          index.ts, SplatView.tsx, splat.nitro.ts, events.ts, errors.ts
    tests/                        jest (types, mocks), cpp/ (ctest), e2e specs
  apps/example/                   plain RN 0.87 app, metro via react-native-monorepo-config
  docs/  CONTRIBUTING.md  CONTEXT.md
```

## Threading model

- JS thread: React render, `hybridRef` calls; every call is a cheap enqueue into the engine command queue, never blocking on GPU.
- UI thread: view lifecycle, surface create and destroy, prop setters (Nitro sets React props on the UI thread), gesture worklets when using Reanimated (UI runtime).
- Render thread (one per view, both platforms): owns the GPU device, drains the command queue, draws when dirty, publishes an immutable pose snapshot (seqlock or double buffer) for sync readers.
  Android renders off the main thread as the platform advises; iOS drives from `CADisplayLink` on the render thread's run loop (existing code drives it from main, see `SplatKitRNView.mm`).
- Worker pool in the C++ core: load, decode, sort, LOD.
- Event egress: render thread pushes into per-type latest-wins slots; a pump hands them to Nitro callbacks, which Nitro dispatches onto the JS thread.
- Sync reads (`readFrameState`, `project`) may be called from JS or the UI runtime and only touch the published snapshot.

## Public TypeScript sketch

```ts
// splat.nitro.ts (Nitro spec, deep module: small surface)
export type CameraMode = 'firstPerson' | 'orbit'
export interface CameraRequest {            // one revisioned struct, no scalar flattening
  revision: number
  mode: CameraMode
  anchor?: Vec3
  radius: number; azimuth: number; elevation: number
  orbitRadiansPerSecond: number
}
export interface WorldRequest { requestId: string; filePath: string; maxShDegree: number }
export interface Vec3 { x: number; y: number; z: number }
export type SplatErrorCode = 'invalid-argument' | 'load-failed' | 'gpu-unavailable' | 'disposed'
export interface SplatEvent {               // discriminated, requestId/revision echo
  kind: 'world' | 'camera' | 'policy' | 'capabilities'
  id: string | number
  phase: 'applied' | 'ready' | 'rejected' | 'failed'
  code?: SplatErrorCode
  message?: string
}
export interface SplatViewProps extends HybridViewProps {
  world?: WorldRequest
  camera?: CameraRequest
  paused?: boolean
  onEvent: (e: SplatEvent) => void          // wrap with callback(...)
  onStats?: (s: FrameStats) => void         // throttled, latest-wins
}
export interface SplatViewMethods extends HybridViewMethods {
  // input: sync, enqueue-only, safe on UI runtime
  orbit(dAzimuth: number, dElevation: number): void
  dolly(delta: number): void
  setPose(pose: CameraPose): void
  pick(x: number, y: number): Promise<PickResult | null>
  // per-frame channel: fills caller-owned Float32Array buffer, returns frame counter
  readFrameState(out: ArrayBuffer): number  // [pose(5), viewProj(16), size(2)]
  project(worldXyz: ArrayBuffer, outXy: ArrayBuffer): number // for part labels
  dispose(): void                           // idempotent
}
export type SplatView = HybridView<SplatViewProps, SplatViewMethods>
```

Per-frame channel rules:
- JS or a worklet allocates one `Float32Array` once and reuses it; Nitro treats it as non-owning, so native copies out during the call only.
- Overlay loop: `useFrameCallback` on the UI runtime calls `project(...)` with label anchors, writes shared values, `useAnimatedStyle` positions labels; zero JS-thread work per frame.
- `onStats` and events are never per-frame; cap at about 4 Hz and coalesce.
- Public wrapper `<SplatView>` hides `callback()`, applies dev-only warnings, and exposes a stable `SplatViewHandle` type from `src/index.ts`.

## Build-from-source plan

iOS (CocoaPods now, SwiftPM later):
- Podspec at package root: `source_files = ['ios/**/*.{h,m,mm,swift}', 'cpp/**/*.{h,hpp,cpp}', 'nitrogen/generated/shared/**/*.{h,hpp,cpp}', 'nitrogen/generated/ios/**/*.{h,hpp,cpp,mm,swift}']`, `load 'nitrogen/generated/ios/<Name>+autolinking.rb'` and `add_nitrogen_files(s)` (the VisionCamera pattern), then `install_modules_dependencies(s)` last.
- `pod_target_xcconfig`: `CLANG_CXX_LANGUAGE_STANDARD = c++20`, `HEADER_SEARCH_PATHS` for `cpp/`, `USE_HEADERMAP = NO` as WebGPU does; `s.frameworks = ['Metal', 'QuartzCore', 'UIKit']`; `s.libraries = 'c++', 'z'` if zlib is still needed.
- Metal: keep the embed-source approach (shader text compiled into the binary at build by a CMake or script step, `newLibraryWithSource` at runtime) so no metallib ships in the host bundle; it also sidesteps pod metal-toolchain questions.
- Everything compiles inside the app's Xcode build; enable `USE_CCACHE=1` at `pod install`.
- Later: add `Package.swift` once RN's SwiftPM path leaves experimental; until then do not rely on `npx react-native spm scaffold`.

Android (CMake plus gradle):
- `android/build.gradle`: apply `com.facebook.react`, `externalNativeBuild.cmake` with `path 'CMakeLists.txt'`, arguments `-DANDROID_STL=c++_shared`, `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`, `-DCMAKE_CXX_COMPILER_LAUNCHER=ccache`, `abiFilters(*reactNativeArchitectures())`; apply the nitrogen `+autolinking.gradle`; register the generated view manager in the package class.
- `android/CMakeLists.txt`: `add_subdirectory(../cpp core)` for a static `splatkit_core`; shared `splatkit_android` links core, Nitro's `NitroModules`, `ReactAndroid` and `fbjni` (prefab), plus `vulkan` and `android` from the NDK; include the generated `+autolinking.cmake`.
- Vulkan surface: Kotlin `SurfaceView` (with a `TextureView` mode behind a prop for transparency or layering), `Surface` to `ANativeWindow_fromSurface` in JNI, release on `surfaceDestroyed`; render thread owns the swapchain.
- Shaders: compile GLSL to SPIR-V at build (NDK ships `glslc` under `shader-tools/`; AGP compiles `src/main/shaders/` for app modules, library-module behavior (unverified)) or embed pre-generated SPIR-V arrays from the CMake step.
  Source: https://developer.android.com/ndk/guides/graphics/shader-compilers
- Keep build directories outside `~/Documents` for agent runs (configure with an explicit out-of-tree dir).

Shared:
- Root scripts: `nitrogen` (regenerate and commit), `typecheck`, `test`, `test:cpp` (ctest against `cpp/` with a null GPU backend), `build:ios`, `build:android` via turbo with declared inputs.
- CI checks: `git diff --exit-code nitrogen/` after regeneration, so generated code cannot drift.
- Pin `react-native-nitro-modules` and `nitrogen` to the same exact version, upgrade deliberately.

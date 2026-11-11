// The JNI entry points of com.splatkit.engine.SplatEngine. Each one checks the handle
// and forwards to the SplatEngine; the layouts of the arrays shared with Kotlin are in
// JniConversions.h.

#include <jni.h>

#include <android/native_window_jni.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>

#include "engine/AndroidEngine.h"
#include "engine/TraceSection.h"
#include "jni/JniConversions.h"
#include "splat/core/CoordinateFrame.h"
#include "splatkit/Log.h"

// `SPLATKIT_JNI(void, nativeLook)(JNIEnv*, jobject, ...)` declares the exported symbol
// the JVM binds to `SplatEngine.nativeLook`. The package is part of the name.
#define SPLATKIT_JNI(returnType, name) \
  extern "C" JNIEXPORT returnType JNICALL Java_com_splatkit_engine_SplatEngine_##name

namespace {

using splatkit::TraceSection;
using splatkit::jni::cameraPoseToFloats;
using splatkit::jni::cameraRequestFromDoubles;
using splatkit::jni::cameraStateToDoubles;
using splatkit::jni::capabilitiesToDoubles;
using splatkit::jni::flag;
using splatkit::jni::kAttitudeFloats;
using splatkit::jni::kCameraRequestFields;
using splatkit::jni::kCameraResolutionFields;
using splatkit::jni::kCameraStateFields;
using splatkit::jni::kCapabilityFields;
using splatkit::jni::kPolicyFields;
using splatkit::jni::kPolicyResolutionFields;
using splatkit::jni::kPoseFloats;
using splatkit::jni::kStatsFloats;
using splatkit::jni::policyFromDoubles;
using splatkit::jni::policyToDoubles;
using splatkit::jni::statsToFloats;
using splatkit::jni::toJni;
using splatkit::jni::withBytes;
using splatkit::jni::withUtf8;
namespace trace = splatkit::trace;

// The handle Kotlin holds is the host's address; JNI has no other way to carry it.
splatkit::AndroidEngine* toHost(jlong handle) {
  return reinterpret_cast<splatkit::AndroidEngine*>(handle);  // NOLINT(performance-no-int-to-ptr)
}

splatkit::SplatEngine* toEngine(jlong handle) {
  auto* host = toHost(handle);
  return host != nullptr ? &host->engine() : nullptr;
}

JavaVM* gVm = nullptr;

// Delivers engine events to SplatEngine.onNativeEvent on whatever thread raised them.
// Both threads that can raise one (the loader executor and the render HandlerThread)
// are Java threads, so GetEnv succeeds; a native thread would be attached for the call.
class EventBridge {
 public:
  EventBridge(JNIEnv* env, jobject engine) : engine_(env->NewGlobalRef(engine)) {
    jclass cls = env->GetObjectClass(engine);
    method_ = env->GetMethodID(cls, "onNativeEvent", "(ILjava/lang/String;I)V");
    env->DeleteLocalRef(cls);
    // A signature drift between the .so and SplatEngine would otherwise surface as a
    // pending exception thrown out of a later render call.
    if (env->ExceptionCheck()) {
      env->ExceptionClear();
      method_ = nullptr;
      LOGE("SplatEngine.onNativeEvent not found: events will not be delivered");
    }
  }
  ~EventBridge() {
    JNIEnv* env = nullptr;
    if (gVm != nullptr && gVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_OK) {
      env->DeleteGlobalRef(engine_);
    }
  }

  EventBridge(const EventBridge&) = delete;
  EventBridge& operator=(const EventBridge&) = delete;

  void operator()(int event, const std::string& message, uint32_t count) const {
    if (gVm == nullptr || method_ == nullptr) return;
    JNIEnv* env = nullptr;
    bool attached = false;
    if (gVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
      if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
      attached = true;
    }
    jstring text = env->NewStringUTF(message.c_str());
    env->CallVoidMethod(engine_, method_, static_cast<jint>(event), text, static_cast<jint>(count));
    env->DeleteLocalRef(text);
    if (attached) gVm->DetachCurrentThread();
  }

 private:
  jobject engine_;
  jmethodID method_ = nullptr;
};

}  // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  gVm = vm;
  return JNI_VERSION_1_6;
}

// Lifetime.

SPLATKIT_JNI(jlong, nativeCreate)(JNIEnv* env, jobject thiz, jstring cacheDir) {
  std::string directory;
  withUtf8(env, cacheDir, [&directory](const std::string& d) { directory = d; });
  auto result = splatkit::AndroidEngine::create(directory);
  if (!result) {
    LOGE("engine creation failed: %s", result.error().message.c_str());
    return 0;
  }
  splatkit::AndroidEngine* host = result.value().release();
  // The bridge lives in the sink and dies with the engine.
  host->setEventSink([bridge = std::make_shared<EventBridge>(env, thiz)](
                         int e, const std::string& m, uint32_t c) { (*bridge)(e, m, c); });
  return reinterpret_cast<jlong>(host);
}

SPLATKIT_JNI(void, nativeDestroy)(JNIEnv*, jobject, jlong handle) {
  delete toHost(handle);
}

SPLATKIT_JNI(jstring, nativeGpuDescription)(JNIEnv* env, jobject, jlong handle) {
  auto* engine = toEngine(handle);
  return env->NewStringUTF(engine != nullptr ? engine->gpuDescription().c_str() : "");
}

// Surface and frames.

SPLATKIT_JNI(void, nativeSetSurface)(JNIEnv* env, jobject, jlong handle, jobject surface) {
  auto* host = toHost(handle);
  if (host == nullptr) return;
  if (surface == nullptr) {
    host->setWindow(nullptr);
    return;
  }
  ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) LOGE("the Surface has no native window; the view stays blank");
  host->setWindow(window);
  // The engine holds its own reference; drop the one fromSurface gave us.
  if (window != nullptr) ANativeWindow_release(window);
}

SPLATKIT_JNI(void, nativeSurfaceResized)(JNIEnv*, jobject, jlong handle, jint width, jint height) {
  if (auto* host = toHost(handle)) {
    host->onSurfaceResized(static_cast<uint32_t>(width), static_cast<uint32_t>(height));
  }
}

SPLATKIT_JNI(void, nativeRender)(JNIEnv*, jobject, jlong handle, jlong frameTimeNanos) {
  if (auto* host = toHost(handle)) host->render(frameTimeNanos);
}

// Loading.

SPLATKIT_JNI(void, nativeLoadWorld)(JNIEnv* env, jobject, jlong handle, jbyteArray bytes) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return;
  withBytes(env, bytes, [engine](const std::uint8_t* data, std::size_t size) {
    const TraceSection section(trace::kDecodeWorld);
    engine->loadWorld(data, size);
  });
}

SPLATKIT_JNI(void, nativeLoadCollider)(JNIEnv* env, jobject, jlong handle, jbyteArray bytes) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return;
  withBytes(env, bytes, [engine](const std::uint8_t* data, std::size_t size) {
    const TraceSection section(trace::kDecodeCollider);
    engine->loadCollider(data, size);
  });
}

SPLATKIT_JNI(void, nativeLoadWorldFile)(JNIEnv* env, jobject, jlong handle, jstring path) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return;
  withUtf8(env, path, [engine](const std::string& p) {
    const TraceSection section(trace::kDecodeWorld);
    engine->loadWorldFile(p);
  });
}

SPLATKIT_JNI(void, nativeLoadTiledWorldFile)(JNIEnv* env, jobject, jlong handle, jstring path) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return;
  withUtf8(env, path, [engine](const std::string& p) {
    const TraceSection section(trace::kDecodeWorld);
    engine->loadTiledWorldFile(p);
  });
}

SPLATKIT_JNI(void, nativeLoadColliderFile)(JNIEnv* env, jobject, jlong handle, jstring path) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return;
  withUtf8(env, path, [engine](const std::string& p) {
    const TraceSection section(trace::kDecodeCollider);
    engine->loadColliderFile(p);
  });
}

// Camera and input.

SPLATKIT_JNI(void, nativeSetCameraPose)
(JNIEnv*, jobject, jlong handle, jfloat x, jfloat y, jfloat z, jfloat yaw, jfloat pitch) {
  if (auto* engine = toEngine(handle)) engine->setCameraPose({x, y, z, yaw, pitch});
}

SPLATKIT_JNI(void, nativeSetCameraLookAt)
(JNIEnv*, jobject, jlong handle, jfloat fromX, jfloat fromY, jfloat fromZ, jfloat targetX,
 jfloat targetY, jfloat targetZ, jfloat upX, jfloat upY, jfloat upZ) {
  if (auto* engine = toEngine(handle)) {
    engine->setCameraLookAt({fromX, fromY, fromZ}, {targetX, targetY, targetZ}, {upX, upY, upZ});
  }
}

SPLATKIT_JNI(void, nativeSetAnchor)
(JNIEnv*, jobject, jlong handle, jfloat x, jfloat y, jfloat z) {
  if (auto* engine = toEngine(handle)) engine->setCameraAnchor({x, y, z});
}

SPLATKIT_JNI(jboolean, nativeOrbit)
(JNIEnv*, jobject, jlong handle, jfloat deltaAzimuth, jfloat deltaElevation) {
  auto* engine = toEngine(handle);
  return toJni(engine != nullptr && engine->orbit(deltaAzimuth, deltaElevation));
}

SPLATKIT_JNI(jboolean, nativeDolly)(JNIEnv*, jobject, jlong handle, jfloat deltaRadius) {
  auto* engine = toEngine(handle);
  return toJni(engine != nullptr && engine->dolly(deltaRadius));
}

SPLATKIT_JNI(jboolean, nativeFocus)(JNIEnv*, jobject, jlong handle, jfloat x, jfloat y) {
  auto* engine = toEngine(handle);
  return toJni(engine != nullptr && engine->focus(x, y));
}

SPLATKIT_JNI(jboolean, nativeStartOrbitAnimation)
(JNIEnv*, jobject, jlong handle, jfloat degrees, jfloat degreesPerSecond, jboolean easeInOut) {
  auto* engine = toEngine(handle);
  return toJni(engine != nullptr &&
               engine->startOrbitAnimation(degrees, degreesPerSecond, easeInOut == JNI_TRUE));
}

// Fills out[0..4]: x, y, z, yaw, pitch.
SPLATKIT_JNI(void, nativeCameraPose)(JNIEnv* env, jobject, jlong handle, jfloatArray out) {
  auto* engine = toEngine(handle);
  if (engine == nullptr || out == nullptr || env->GetArrayLength(out) < kPoseFloats) return;
  float values[kPoseFloats]{};
  cameraPoseToFloats(engine->cameraPose(), values);
  env->SetFloatArrayRegion(out, 0, kPoseFloats, values);
}

SPLATKIT_JNI(void, nativeCameraState)(JNIEnv* env, jobject, jlong handle, jdoubleArray out) {
  auto* engine = toEngine(handle);
  if (engine == nullptr || out == nullptr || env->GetArrayLength(out) < kCameraStateFields) return;
  double values[kCameraStateFields]{};
  cameraStateToDoubles(engine->cameraState(), values);
  env->SetDoubleArrayRegion(out, 0, kCameraStateFields, values);
}

// Applies once, then returns accepted plus a snapshot of the effective state atomically.
SPLATKIT_JNI(jstring, nativeApplyCameraRequest)
(JNIEnv* env, jobject, jlong handle, jdoubleArray requested, jdoubleArray out) {
  auto* engine = toEngine(handle);
  if (engine == nullptr || requested == nullptr || out == nullptr ||
      env->GetArrayLength(requested) < kCameraRequestFields ||
      env->GetArrayLength(out) < kCameraResolutionFields) {
    return env->NewStringUTF("SplatKit camera request unavailable");
  }
  double input[kCameraRequestFields]{};
  env->GetDoubleArrayRegion(requested, 0, kCameraRequestFields, input);
  const auto resolution = engine->applyCameraRequest(cameraRequestFromDoubles(input));
  double values[kCameraResolutionFields]{};
  values[0] = flag(resolution.accepted);
  cameraStateToDoubles(resolution.effective, values + 1);
  env->SetDoubleArrayRegion(out, 0, kCameraResolutionFields, values);
  return env->NewStringUTF(resolution.error.c_str());
}

SPLATKIT_JNI(void, nativeLook)(JNIEnv*, jobject, jlong handle, jfloat deltaYaw, jfloat deltaPitch) {
  if (auto* engine = toEngine(handle)) engine->look(deltaYaw, deltaPitch);
}

SPLATKIT_JNI(void, nativeWalk)(JNIEnv*, jobject, jlong handle, jfloat forward, jfloat right) {
  if (auto* engine = toEngine(handle)) engine->walk(forward, right);
}

SPLATKIT_JNI(void, nativeSetVelocity)
(JNIEnv*, jobject, jlong handle, jfloat forward, jfloat right) {
  if (auto* engine = toEngine(handle)) engine->setVelocity(forward, right);
}

SPLATKIT_JNI(jboolean, nativeSetCharacter)
(JNIEnv*, jobject, jlong handle, jfloat eyeHeight, jfloat bodyRadius, jfloat stepHeight) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return JNI_FALSE;
  splat::CharacterSettings character = engine->character();
  character.eyeHeight = eyeHeight;
  character.bodyRadius = bodyRadius;
  character.stepHeight = stepHeight;
  return toJni(engine->setCharacter(character));
}

SPLATKIT_JNI(jboolean, nativeSetLens)
(JNIEnv*, jobject, jlong handle, jboolean hasFieldOfView, jfloat fieldOfViewDegrees,
 jboolean hasDepthRange, jfloat nearPlane, jfloat farPlane) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return JNI_FALSE;
  splatkit::LensSettings settings;
  if (hasFieldOfView) settings.fieldOfViewDegrees = fieldOfViewDegrees;
  if (hasDepthRange) settings.depthRange = splatkit::DepthRange{nearPlane, farPlane};
  return toJni(engine->setLens(settings));
}

// `rowMajor` is the 3x3 device to reference rotation as Android hands it out.
SPLATKIT_JNI(void, nativeSetAttitude)(JNIEnv* env, jobject, jlong handle, jfloatArray rowMajor) {
  auto* engine = toEngine(handle);
  if (engine == nullptr || rowMajor == nullptr || env->GetArrayLength(rowMajor) < kAttitudeFloats) {
    return;
  }
  float m[kAttitudeFloats];
  env->GetFloatArrayRegion(rowMajor, 0, kAttitudeFloats, m);
  engine->setAttitude(m);
}

SPLATKIT_JNI(void, nativeSetMotionEnabled)(JNIEnv*, jobject, jlong handle, jboolean enabled) {
  if (auto* engine = toEngine(handle)) engine->setMotionEnabled(enabled == JNI_TRUE);
}

// Quality settings.

SPLATKIT_JNI(void, nativeSetRenderScale)(JNIEnv*, jobject, jlong handle, jfloat scale) {
  if (auto* engine = toEngine(handle)) engine->setRenderScale(scale);
}

SPLATKIT_JNI(void, nativeSetCullMargin)(JNIEnv*, jobject, jlong handle, jfloat degrees) {
  if (auto* engine = toEngine(handle)) engine->setCullMargin(degrees);
}

SPLATKIT_JNI(void, nativeSetLinearBlending)(JNIEnv*, jobject, jlong handle, jboolean linear) {
  if (auto* engine = toEngine(handle)) engine->setLinearBlending(linear == JNI_TRUE);
}

SPLATKIT_JNI(void, nativeSetSplatBudget)(JNIEnv*, jobject, jlong handle, jint budget) {
  if (auto* engine = toEngine(handle)) engine->setSplatBudget(budget);
}

SPLATKIT_JNI(void, nativeSetResidencyBudget)(JNIEnv*, jobject, jlong handle, jint splats) {
  if (auto* engine = toEngine(handle)) engine->setResidencyBudget(splats);
}

SPLATKIT_JNI(void, nativeSetMaxShDegree)(JNIEnv*, jobject, jlong handle, jint degree) {
  if (auto* engine = toEngine(handle)) engine->setMaxShDegree(degree);
}

SPLATKIT_JNI(void, nativeSetShDegree)(JNIEnv*, jobject, jlong handle, jint degree) {
  if (auto* engine = toEngine(handle)) engine->setShDegree(degree);
}

// A null `letters` clears the frame. False when they name no frame; the previous one stays.
SPLATKIT_JNI(jboolean, nativeSetSourceFrame)(JNIEnv* env, jobject, jlong handle, jstring letters) {
  auto* engine = toEngine(handle);
  if (engine == nullptr) return JNI_FALSE;
  if (letters == nullptr) {
    engine->setSourceFrame(std::nullopt);
    return JNI_TRUE;
  }
  bool parsed = false;
  withUtf8(env, letters, [engine, &parsed](const std::string& text) {
    const auto frame = splat::CoordinateFrame::parse(text);
    if (!frame) return;
    engine->setSourceFrame(frame);
    parsed = true;
  });
  return toJni(parsed);
}

// Diagnostics.

SPLATKIT_JNI(void, nativeStartBenchmark)(JNIEnv*, jobject, jlong handle, jfloat seconds) {
  if (auto* engine = toEngine(handle)) engine->startBenchmark(seconds);
}

// Fills out[0..8] in the order kStatsFloats lists.
SPLATKIT_JNI(void, nativeStats)(JNIEnv* env, jobject, jlong handle, jfloatArray out) {
  auto* engine = toEngine(handle);
  if (engine == nullptr || out == nullptr || env->GetArrayLength(out) < kStatsFloats) return;
  float values[kStatsFloats]{};
  statsToFloats(engine->stats(), values);
  env->SetFloatArrayRegion(out, 0, kStatsFloats, values);
}

// Policy and capabilities.

// out[0..25]: limits and feature flags [0..5], policy support [6..17], fallback policy [18..25].
SPLATKIT_JNI(void, nativeCapabilities)(JNIEnv* env, jobject, jlong handle, jdoubleArray out) {
  const splatkit::SplatEngine* engine = toEngine(handle);
  if (engine == nullptr || out == nullptr || env->GetArrayLength(out) < kCapabilityFields) return;
  double values[kCapabilityFields]{};
  capabilitiesToDoubles(engine->deviceCapabilities(), values);
  env->SetDoubleArrayRegion(out, 0, kCapabilityFields, values);
}

// requested[0..7] in; out[0] accepted, out[1] preparationFailed, out[2..9] the effective
// policy. Returns the rejection reason, or one warning per fallback; both are also logged.
SPLATKIT_JNI(jobjectArray, nativeApplyRenderPolicy)
(JNIEnv* env, jobject, jlong handle, jdoubleArray requested, jdoubleArray out) {
  jclass stringClass = env->FindClass("java/lang/String");
  splatkit::SplatEngine* engine = toEngine(handle);
  if (engine == nullptr || requested == nullptr || out == nullptr ||
      env->GetArrayLength(requested) < kPolicyFields ||
      env->GetArrayLength(out) < kPolicyResolutionFields) {
    return env->NewObjectArray(0, stringClass, nullptr);
  }
  double input[kPolicyFields];
  env->GetDoubleArrayRegion(requested, 0, kPolicyFields, input);
  const splatkit::RenderPolicyResolution resolution =
      engine->setRenderPolicy(policyFromDoubles(input));
  double values[kPolicyResolutionFields]{};
  values[0] = flag(resolution.accepted);
  values[1] = flag(resolution.preparationFailed);
  policyToDoubles(resolution.effective, values + 2);
  env->SetDoubleArrayRegion(out, 0, kPolicyResolutionFields, values);

  if (!resolution.accepted) {
    LOGE("render policy rejected: %s", resolution.error.c_str());
    jobjectArray messages = env->NewObjectArray(1, stringClass, nullptr);
    jstring reason = env->NewStringUTF(resolution.error.c_str());
    env->SetObjectArrayElement(messages, 0, reason);
    env->DeleteLocalRef(reason);
    return messages;
  }
  const auto count = static_cast<jsize>(resolution.warnings.size());
  jobjectArray messages = env->NewObjectArray(count, stringClass, nullptr);
  for (jsize i = 0; i < count; ++i) {
    const std::string& message = resolution.warnings[static_cast<size_t>(i)].message;
    LOGW("render policy: %s", message.c_str());
    jstring text = env->NewStringUTF(message.c_str());
    env->SetObjectArrayElement(messages, i, text);
    env->DeleteLocalRef(text);
  }
  return messages;
}

// out[0..8]: the policy currently applied to this instance.
SPLATKIT_JNI(void, nativeRenderPolicy)(JNIEnv* env, jobject, jlong handle, jdoubleArray out) {
  const splatkit::SplatEngine* engine = toEngine(handle);
  if (engine == nullptr || out == nullptr || env->GetArrayLength(out) < kPolicyFields) return;
  double values[kPolicyFields]{};
  policyToDoubles(engine->renderPolicy(), values);
  env->SetDoubleArrayRegion(out, 0, kPolicyFields, values);
}

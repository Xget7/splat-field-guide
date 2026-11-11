// The conversions between the Java side of SplatEngine and the C++ engine: the layouts of
// the primitive arrays Kotlin shares with the JNI, and the helpers that hand Java strings
// and byte arrays to C++. Every layout is documented where it is written.

#pragma once

#include <jni.h>

#include <cstddef>
#include <cstdint>
#include <string>

#include "splatkit/engine/SplatEngine.h"

namespace splatkit::jni {

inline constexpr jsize kPoseFloats = 5;
inline constexpr jsize kCameraRequestFields = 8;
inline constexpr jsize kCameraStateFields = 9;
inline constexpr jsize kCameraResolutionFields = kCameraStateFields + 1;
// fps, frame, gpu and sort milliseconds, splat count, walking and motion flags, then the drawn
// count and the world's SH degree.
inline constexpr jsize kStatsFloats = 9;
inline constexpr jsize kAttitudeFloats = 9;

// Policy and capabilities. Both arrays are double: every field is a count, flag or float.
inline constexpr jsize kPolicyFields = 8;  // see policyFromDoubles
// accepted, preparationFailed, then the effective policy
inline constexpr jsize kPolicyResolutionFields = kPolicyFields + 2;
// Capabilities: limits and feature flags, policy support, then the fallback policy.
inline constexpr jsize kCapabilityLeadFields = 6;
inline constexpr jsize kPolicySupportFields = 12;
inline constexpr jsize kCapabilityFields =
    kCapabilityLeadFields + kPolicySupportFields + kPolicyFields;

constexpr jboolean toJni(bool value) {
  return value ? JNI_TRUE : JNI_FALSE;
}

constexpr double flag(bool value) {
  return value ? 1.0 : 0.0;
}

// out[0..4]: x, y, z, yaw, pitch.
void cameraPoseToFloats(const CameraPose& pose, float* out);

// State: mode, anchor xyz, radius, azimuth, elevation, angular rate, hasAnchor.
void cameraStateToDoubles(const CameraState& state, double* out);

// Request: mode, anchor xyz, radius, azimuth, elevation, angular rate.
CameraRequest cameraRequestFromDoubles(const double* in);

// Fills out[0..8] in the order kStatsFloats lists.
void statsToFloats(const Stats& stats, float* out);

// 0 lodErrorPixels, 1 alphaThreshold, 2 subpixelThreshold, 3 enableFrustumCulling,
// 4 enableHiZOcclusion, 5 enableEarlyTermination, 6 sortDepth, 7 lodSplatLimit.
RenderPolicy policyFromDoubles(const double* in);
void policyToDoubles(const RenderPolicy& policy, double* out);

// out[0..25]: limits and feature flags [0..5], policy support [6..17], fallback policy [18..25].
void capabilitiesToDoubles(const DeviceCapabilities& caps, double* out);

// Hands the bytes of a Java array to `use` without copying them for longer than the call.
template <typename Use>
void withBytes(JNIEnv* env, jbyteArray bytes, Use use) {
  if (bytes == nullptr) return;
  const jsize size = env->GetArrayLength(bytes);
  jbyte* data = env->GetByteArrayElements(bytes, nullptr);
  if (data == nullptr) return;
  use(reinterpret_cast<const std::uint8_t*>(data), static_cast<std::size_t>(size));
  env->ReleaseByteArrayElements(bytes, data, JNI_ABORT);
}

template <typename Use>
void withUtf8(JNIEnv* env, jstring text, Use use) {
  if (text == nullptr) return;
  const char* chars = env->GetStringUTFChars(text, nullptr);
  if (chars == nullptr) return;
  use(std::string(chars));
  env->ReleaseStringUTFChars(text, chars);
}

}  // namespace splatkit::jni

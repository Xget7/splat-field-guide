#include "jni/JniConversions.h"

namespace splatkit::jni {

void cameraPoseToFloats(const CameraPose& pose, float* out) {
  out[0] = pose.x;
  out[1] = pose.y;
  out[2] = pose.z;
  out[3] = pose.yaw;
  out[4] = pose.pitch;
}

void cameraStateToDoubles(const CameraState& state, double* out) {
  out[0] = static_cast<double>(static_cast<int>(state.mode));
  out[1] = state.anchor.x;
  out[2] = state.anchor.y;
  out[3] = state.anchor.z;
  out[4] = state.radius;
  out[5] = state.azimuth;
  out[6] = state.elevation;
  out[7] = state.orbitRadiansPerSecond;
  out[8] = flag(state.hasAnchor);
}

CameraRequest cameraRequestFromDoubles(const double* in) {
  CameraRequest request;
  request.mode = static_cast<CameraMode>(static_cast<int>(in[0]));
  request.anchor = {static_cast<float>(in[1]), static_cast<float>(in[2]),
                    static_cast<float>(in[3])};
  request.radius = static_cast<float>(in[4]);
  request.azimuth = static_cast<float>(in[5]);
  request.elevation = static_cast<float>(in[6]);
  request.orbitRadiansPerSecond = static_cast<float>(in[7]);
  return request;
}

void statsToFloats(const Stats& stats, float* out) {
  // Float transport represents every integer through 2^24 exactly; larger counts can round.
  out[0] = stats.fps;
  out[1] = stats.frameMillis;
  out[2] = stats.gpuMillis;
  out[3] = stats.sortMillis;
  out[4] = static_cast<float>(stats.splatCount);
  out[5] = stats.walking ? 1.0f : 0.0f;
  out[6] = stats.motion ? 1.0f : 0.0f;
  out[7] = static_cast<float>(stats.drawnSplatCount);
  out[8] = static_cast<float>(stats.loadedShDegree);
}

RenderPolicy policyFromDoubles(const double* in) {
  RenderPolicy p;
  p.lodErrorPixels = static_cast<float>(in[0]);
  p.alphaThreshold = static_cast<float>(in[1]);
  p.subpixelThreshold = static_cast<float>(in[2]);
  p.enableFrustumCulling = in[3] != 0.0;
  p.enableHiZOcclusion = in[4] != 0.0;
  p.enableEarlyTermination = in[5] != 0.0;
  p.sortDepth = static_cast<SortKeyBits>(static_cast<uint32_t>(in[6]));
  p.lodSplatLimit = static_cast<uint32_t>(in[7]);
  return p;
}

void policyToDoubles(const RenderPolicy& policy, double* out) {
  out[0] = static_cast<double>(policy.lodErrorPixels);
  out[1] = static_cast<double>(policy.alphaThreshold);
  out[2] = static_cast<double>(policy.subpixelThreshold);
  out[3] = flag(policy.enableFrustumCulling);
  out[4] = flag(policy.enableHiZOcclusion);
  out[5] = flag(policy.enableEarlyTermination);
  out[6] = static_cast<double>(static_cast<uint32_t>(policy.sortDepth));
  out[7] = static_cast<double>(policy.lodSplatLimit);
}

namespace {

void supportToDoubles(const RenderPolicySupport& support, double* out) {
  out[0] = flag(support.lodErrorPixels);
  out[1] = flag(support.alphaThreshold);
  out[2] = flag(support.subpixelThreshold);
  out[3] = flag(support.enableFrustumCulling);
  out[4] = flag(support.enableHiZOcclusion);
  out[5] = flag(support.enableEarlyTermination);
  out[6] = flag(support.sortDepth);
  out[7] = static_cast<double>(support.minLodErrorPixels);
  out[8] = static_cast<double>(support.maxLodErrorPixels);
  out[9] = static_cast<double>(support.minSubpixelThreshold);
  out[10] = static_cast<double>(support.maxSubpixelThreshold);
  out[11] = flag(support.lodSplatLimit);
}

}  // namespace

void capabilitiesToDoubles(const DeviceCapabilities& caps, double* out) {
  out[0] = static_cast<double>(caps.limits.maxLodCapacitySplats);
  out[1] = static_cast<double>(caps.limits.minResidencyCapacitySplats);
  out[2] = static_cast<double>(caps.limits.maxResidencyCapacitySplats);
  out[3] = flag(caps.supportsHiZOcclusion);
  out[4] = flag(caps.supportsSubgroups);
  out[5] = static_cast<double>(caps.maxTextureDimension);
  supportToDoubles(caps.policy, out + kCapabilityLeadFields);
  policyToDoubles(caps.policy.fallback, out + kCapabilityLeadFields + kPolicySupportFields);
}

}  // namespace splatkit::jni

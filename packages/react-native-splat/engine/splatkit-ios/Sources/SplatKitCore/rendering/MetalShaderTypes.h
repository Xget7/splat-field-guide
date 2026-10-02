#pragma once

#include <cstddef>
#include <cstdint>

#include "splat/math/Mat4.h"

namespace splatkit {

// Host layouts for shaders/SplatTypes.metalh. Private to the Metal renderer.
// World records remain in the platform-independent GpuLayout.h.
struct alignas(16) CameraUniform {
  splat::Mat4 view;
  splat::Mat4 proj;
  float focal[2];
  float tanHalfFov[2];
  float screenSize[2];
  float reveal[2];  // Frame::revealLevel, Frame::revealBand
  float cameraPosition[4];
};
static_assert(sizeof(CameraUniform) == 176);
static_assert(offsetof(CameraUniform, focal) == 128);
static_assert(offsetof(CameraUniform, cameraPosition) == 160);

struct alignas(8) ProjectedSplat {
  float center[2];
  uint32_t axis1;
  uint32_t axis2;
  uint32_t color0;
  uint32_t color1;
  float radius;
  uint32_t index;
};
static_assert(sizeof(ProjectedSplat) == 32);
static_assert(offsetof(ProjectedSplat, index) == 28);

// Index of the shaders' [[function_constant(n)]] declaration for the SH degree.
inline constexpr size_t kFnShDegree = 0;

}  // namespace splatkit

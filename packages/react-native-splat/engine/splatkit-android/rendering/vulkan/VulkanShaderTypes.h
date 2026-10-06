#pragma once

#include <cstddef>
#include <cstdint>

#include "splat/math/Mat4.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {

// splat.vert and visibility.comp share this host ABI; source splats use GpuLayout.h.
struct alignas(16) CameraUniform {
  splat::Mat4 view;
  splat::Mat4 proj;
  float focal[2];
  float tanHalfFov[2];
  float screenSize[2];
  uint32_t outputLinear;
  uint32_t pad;
  float cameraPosition[4];
  float reveal[4];
  LabelStyles styles;
};
static_assert(sizeof(CameraUniform) == 8384);
static_assert(offsetof(CameraUniform, proj) == 64);
static_assert(offsetof(CameraUniform, focal) == 128);
static_assert(offsetof(CameraUniform, tanHalfFov) == 136);
static_assert(offsetof(CameraUniform, screenSize) == 144);
static_assert(offsetof(CameraUniform, outputLinear) == 152);
static_assert(offsetof(CameraUniform, cameraPosition) == 160);

}

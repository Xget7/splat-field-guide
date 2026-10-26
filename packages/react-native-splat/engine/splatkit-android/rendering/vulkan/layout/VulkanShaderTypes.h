#pragma once

#include <cstddef>
#include <cstdint>

#include "splat/math/Mat4.h"

namespace splatkit {

// Host ABI shared by the splat shaders (layout/splat_camera.glsl), independent of any pass.
// Source and projected splat records are the platform-independent ones in GpuLayout.h.
struct alignas(16) CameraUniform {
  splat::Mat4 view;
  splat::Mat4 proj;
  float focal[2];
  float tanHalfFov[2];
  float screenSize[2];
  uint32_t outputLinear;
  // Clockwise, 0 to 3; only the vertex stages read it (VulkanSwapchain::quarterTurns).
  uint32_t quarterTurns;
  float cameraPosition[4];
  // Pixels: a splat whose source sigma times its quad radius is smaller is not drawn.
  float minPixelRadius;
  float pad[3];
};
static_assert(sizeof(CameraUniform) == 192);
static_assert(offsetof(CameraUniform, proj) == 64);
static_assert(offsetof(CameraUniform, focal) == 128);
static_assert(offsetof(CameraUniform, tanHalfFov) == 136);
static_assert(offsetof(CameraUniform, screenSize) == 144);
static_assert(offsetof(CameraUniform, outputLinear) == 152);
static_assert(offsetof(CameraUniform, quarterTurns) == 156);
static_assert(offsetof(CameraUniform, cameraPosition) == 160);
static_assert(offsetof(CameraUniform, minPixelRadius) == 176);

// Peak opacity at which a splat's quad ends; below it the splat has no quad. constant_id
// kQuadMinAlphaConstant of visibility.comp and splat.vert (splat_footprint.glsl), and the
// alphaThreshold the renderer reports.
inline constexpr float kQuadMinAlpha = 2.0f / 255.0f;
inline constexpr uint32_t kQuadMinAlphaConstant = 1;

// The highest spherical harmonics degree the shaders specialise for, and the constant_id of
// SH_DEGREE in splat_projection.glsl: one pipeline per degree.
inline constexpr int kMaxShDegree = 3;
inline constexpr uint32_t kShDegreeConstant = 0;

}  // namespace splatkit

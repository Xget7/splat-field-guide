#pragma once

#include <cmath>
#include <cstdint>

#include "rendering/vulkan/layout/VulkanShaderTypes.h"

namespace splatkit {

// Prepares the projection shared by selection, visibility and drawing. No GPU dependency:
// false means the caller must skip the world frame, for either sort key width.
inline bool setCameraProjection(CameraUniform& camera, const splat::Mat4& projection,
                                uint32_t width, uint32_t height) {
  camera.proj = projection;
  camera.screenSize[0] = static_cast<float>(width);
  camera.screenSize[1] = static_cast<float>(height);
  for (int axis = 0; axis < 2; ++axis) {
    camera.focal[axis] = camera.screenSize[axis] * projection.at(axis, axis) / 2;
    camera.tanHalfFov[axis] = 1 / projection.at(axis, axis);
    for (const float value : {camera.screenSize[axis], camera.focal[axis], camera.tanHalfFov[axis]})
      if (!std::isfinite(value) || value <= 0) return false;
  }
  camera.nearPlane = projection.at(2, 3) / projection.at(2, 2);
  camera.farPlane = projection.at(2, 3) / (projection.at(2, 2) + 1);
  return std::isfinite(camera.nearPlane) && std::isfinite(camera.farPlane) &&
         camera.nearPlane > 0 && camera.farPlane > camera.nearPlane;
}

}  // namespace splatkit

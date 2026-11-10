#include <cmath>
#include <cstdio>
#include <limits>
#include <stdexcept>

#include "rendering/vulkan/frame/VulkanCameraProjection.h"

namespace {
using splatkit::CameraUniform;
using splatkit::setCameraProjection;

void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

splat::Mat4 projection() {
  return splat::Mat4::perspective(1, 2, 0.1f, 100);
}

void testValidProjection() {
  CameraUniform camera{};
  require(setCameraProjection(camera, projection(), 1200, 600), "valid perspective");
  require(std::abs(camera.nearPlane - 0.1f) < 1e-6f, "near plane");
  require(std::abs(camera.farPlane - 100) < 0.01f, "far plane");
  require(camera.screenSize[0] == 1200 && camera.screenSize[1] == 600, "viewport axes");
  require(std::abs(camera.focal[0] - camera.focal[1]) < 1e-4f, "aspect-correct focal lengths");
  require(std::abs(camera.tanHalfFov[0] - 2 * std::tan(0.5f)) < 1e-6f &&
              std::abs(camera.tanHalfFov[1] - std::tan(0.5f)) < 1e-6f,
          "field of view per axis");
  require(setCameraProjection(camera, projection(), 600, 1200), "rotated window extent");
  require(camera.focal[1] == 4 * camera.focal[0], "focal uses the window orientation");
}

void testInvalidViewportAndFov() {
  CameraUniform camera{};
  require(!setCameraProjection(camera, projection(), 0, 600), "zero width");
  require(!setCameraProjection(camera, projection(), 1200, 0), "zero height");
  for (int axis = 0; axis < 2; ++axis) {
    for (const float coefficient :
         {0.0f, -1.0f, std::numeric_limits<float>::infinity(),
          std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::max(),
          std::numeric_limits<float>::denorm_min()}) {
      auto invalid = projection();
      invalid.at(axis, axis) = coefficient;
      require(!setCameraProjection(camera, invalid, 1200, 600),
              "reject invalid, overflowing or reciprocal-overflowing focal coefficient");
    }
  }
}

void testInvalidDepthRange() {
  CameraUniform camera{};
  // These used to reach the shader, including an empty low16 candidate list. Validation
  // must now reject them independently of candidate count and sort key width.
  require(!setCameraProjection(camera, splat::Mat4::identity(), 1200, 600), "identity projection");
  for (const float coefficient : {0.0f, -1.0f, 1.0f, std::numeric_limits<float>::infinity(),
                                  std::numeric_limits<float>::quiet_NaN()}) {
    auto invalid = projection();
    invalid.at(2, 2) = coefficient;
    require(!setCameraProjection(camera, invalid, 1200, 600), "invalid depth coefficient");
  }
  for (const float offset : {0.0f, 1.0f, std::numeric_limits<float>::infinity(),
                             std::numeric_limits<float>::quiet_NaN()}) {
    auto invalid = projection();
    invalid.at(2, 3) = offset;
    require(!setCameraProjection(camera, invalid, 1200, 600), "invalid depth offset");
  }
  require(!setCameraProjection(camera, splat::Mat4::perspective(1, 2, 100, 0.1f), 1200, 600),
          "reversed depth range");
  require(setCameraProjection(camera, projection(), 1200, 600), "valid frame after rejection");
  require(std::abs(camera.nearPlane - 0.1f) < 1e-6f && std::abs(camera.farPlane - 100) < 0.01f,
          "recovery replaces rejected depth range");
}
}  // namespace

int main() {
  try {
    testValidProjection();
    testInvalidViewportAndFov();
    testInvalidDepthRange();
    std::puts("PASS camera projection: viewport, focal lengths, FOV, depth range and recovery");
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL: %s\n", error.what());
    return 1;
  }
}

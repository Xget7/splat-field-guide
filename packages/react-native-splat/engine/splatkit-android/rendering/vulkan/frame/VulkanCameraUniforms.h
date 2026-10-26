#pragma once

#include <array>
#include <cstdint>
#include <memory>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanBuffer.h"
#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "splat/core/Result.h"
#include "splat/math/Mat4.h"
#include "splat/math/Vec3.h"

namespace splatkit {

// The camera of each frame in flight: one host visible uniform buffer per frame slot, so
// a write never races the GPU reading the slot's previous frame. Render thread only.
class VulkanCameraUniforms {
 public:
  static splat::Result<std::unique_ptr<VulkanCameraUniforms>> create(const VulkanContext& ctx);
  ~VulkanCameraUniforms() = default;

  VulkanCameraUniforms(const VulkanCameraUniforms&) = delete;
  VulkanCameraUniforms& operator=(const VulkanCameraUniforms&) = delete;

  // After the frame-slot fence, before compute/draw. Borrowed uniform stays valid until
  // this object is destroyed. `extent` is in the window's orientation (VulkanSurface::viewExtent);
  // `minPixelRadius` is the sub-pixel cutoff, in pixels.
  VkBuffer update(uint32_t frameSlot, const splat::Mat4& view, const splat::Mat4& proj,
                  const splat::Vec3& cameraPosition, VkExtent2D extent, bool outputLinear,
                  uint32_t quarterTurns, float minPixelRadius);
  VkBuffer buffer(uint32_t frameSlot) const { return uniforms_[frameSlot]->handle(); }

 private:
  VulkanCameraUniforms() = default;

  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> uniforms_{};
};

}  // namespace splatkit

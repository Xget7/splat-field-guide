#include "rendering/vulkan/frame/VulkanCameraUniforms.h"

#include <cstring>

#include "rendering/vulkan/frame/VulkanCameraProjection.h"

namespace splatkit {

splat::Result<std::unique_ptr<VulkanCameraUniforms>> VulkanCameraUniforms::create(
    const VulkanContext& ctx) {
  std::unique_ptr<VulkanCameraUniforms> cameras(new VulkanCameraUniforms());
  for (auto& uniform : cameras->uniforms_) {
    uniform =
        VulkanBuffer::hostVisible(ctx, sizeof(CameraUniform), VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
    if (!uniform) return splat::Error{splat::ErrorCode::gpuUnavailable, "camera uniforms"};
  }
  return cameras;
}

VkBuffer VulkanCameraUniforms::update(uint32_t frameSlot, const splat::Mat4& view,
                                      const splat::Mat4& proj, const splat::Vec3& cameraPosition,
                                      VkExtent2D extent, bool outputLinear, uint32_t quarterTurns,
                                      float minPixelRadius) {
  CameraUniform u{};
  u.cameraPosition[0] = cameraPosition.x;
  u.cameraPosition[1] = cameraPosition.y;
  u.cameraPosition[2] = cameraPosition.z;
  u.view = view;
  if (!setCameraProjection(u, proj, extent.width, extent.height)) return VK_NULL_HANDLE;
  u.outputLinear = outputLinear ? 1u : 0u;
  u.quarterTurns = quarterTurns;
  u.minPixelRadius = minPixelRadius;
  std::memcpy(uniforms_[frameSlot]->mapped(), &u, sizeof(u));
  uniforms_[frameSlot]->flush(0, sizeof(u));
  return uniforms_[frameSlot]->handle();
}

}  // namespace splatkit

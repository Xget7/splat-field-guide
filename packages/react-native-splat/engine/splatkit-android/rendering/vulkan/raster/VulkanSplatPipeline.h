#pragma once

#include <array>
#include <cstdint>
#include <memory>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/frame/VulkanCameraUniforms.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "splat/core/Result.h"

namespace splatkit {

// The Gaussian splat pipeline: one instanced draw, four vertices per splat, blended back to
// front with no depth test. projected.vert expands the records visibility.comp projected; Field
// Guide has no CPU-order path, so upstream's splat.vert pipeline is left out. Owns the descriptor
// set layout and the pipeline; the camera uniforms are borrowed and must outlive it.
class VulkanSplatPipeline {
 public:
  static splat::Result<std::unique_ptr<VulkanSplatPipeline>> create(
      const VulkanContext& ctx, VkRenderPass renderPass, const VulkanCameraUniforms& cameras);
  ~VulkanSplatPipeline();

  VulkanSplatPipeline(const VulkanSplatPipeline&) = delete;
  VulkanSplatPipeline& operator=(const VulkanSplatPipeline&) = delete;

  // GPU path. `projected` must hold `capacity` ProjectedSplat records and `order` `capacity`
  // positions in it; both stay alive until the slot's draw completes.
  void bindProjected(uint32_t frameSlot, VkBuffer projected, VkBuffer order, uint32_t capacity);
  // One VkDrawIndirectCommand at offset 0 of `arguments`.
  void drawProjected(VkCommandBuffer cmd, uint32_t frameSlot, VkBuffer arguments) const;

 private:
  explicit VulkanSplatPipeline(const VulkanContext& ctx) : ctx_(ctx) {}
  bool createDescriptors(const VulkanCameraUniforms& cameras);
  bool createPipelines(VkRenderPass renderPass);
  // Creates the pipeline layout over `setLayout` and one pipeline per entry of `pipelines`,
  // each with SH_DEGREE specialised to its index.
  template <size_t N>
  bool createGraphicsPipelines(VkRenderPass renderPass, VkShaderModule vertex,
                               VkShaderModule fragment, VkDescriptorSetLayout setLayout,
                               VkPipelineLayout& layout, std::array<VkPipeline, N>& pipelines);

  const VulkanContext& ctx_;
  VkDescriptorPool pool_ = VK_NULL_HANDLE;
  // Camera, projected records, order.
  VkDescriptorSetLayout projectedSetLayout_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, kFramesInFlight> projectedSets_{};
  VkPipelineLayout projectedLayout_ = VK_NULL_HANDLE;
  std::array<VkPipeline, 1> projectedPipeline_{};
};

}  // namespace splatkit

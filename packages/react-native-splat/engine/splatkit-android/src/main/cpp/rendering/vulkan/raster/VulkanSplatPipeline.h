#pragma once

#include <array>
#include <cstdint>
#include <memory>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/frame/VulkanCameraUniforms.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "rendering/vulkan/world/VulkanWorld.h"
#include "splat/core/Result.h"

namespace splatkit {

// The Gaussian splat pipelines: one instanced draw, four vertices per splat, blended back to
// front with no depth test. The CPU-order path projects in splat.vert; the GPU path expands
// the records visibility.comp projected, in projected.vert. Owns the descriptor set layouts and
// the pipelines; the camera uniforms are borrowed and must outlive it.
class VulkanSplatPipeline {
 public:
  static splat::Result<std::unique_ptr<VulkanSplatPipeline>> create(
      const VulkanContext& ctx, VkRenderPass renderPass, const VulkanCameraUniforms& cameras);
  ~VulkanSplatPipeline();

  VulkanSplatPipeline(const VulkanSplatPipeline&) = delete;
  VulkanSplatPipeline& operator=(const VulkanSplatPipeline&) = delete;

  // Points the descriptor set of every frame slot at this world's buffers.
  void bindWorld(const VulkanWorld& world);

  // GPU path. `projected` must hold `capacity` ProjectedSplat records and `order` `capacity`
  // positions in it; both stay alive until the slot's draw completes.
  void bindProjected(uint32_t frameSlot, VkBuffer projected, VkBuffer order, uint32_t capacity);
  // One VkDrawIndirectCommand at offset 0 of `arguments`.
  void drawProjected(VkCommandBuffer cmd, uint32_t frameSlot, VkBuffer arguments) const;

  // Draws the first `count` entries of the order buffer with the spherical harmonics
  // bands up to `shDegree`, which must not exceed what the world was uploaded with.
  // The caller updates the frame slot's VulkanCameraUniforms before recording this.
  void draw(VkCommandBuffer cmd, uint32_t frameSlot, const VulkanWorld& world, uint32_t count,
            int shDegree);

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
  // CPU-order path: camera, splats, order, SH.
  VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, kFramesInFlight> sets_{};
  VkPipelineLayout layout_ = VK_NULL_HANDLE;
  // One pipeline per SH degree, specialised so degree 0 worlds pay nothing for SH.
  std::array<VkPipeline, VulkanWorld::kMaxShDegree + 1> pipelines_{};
  // GPU path: camera, projected records, order.
  VkDescriptorSetLayout projectedSetLayout_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, kFramesInFlight> projectedSets_{};
  VkPipelineLayout projectedLayout_ = VK_NULL_HANDLE;
  std::array<VkPipeline, 1> projectedPipeline_{};
};

}  // namespace splatkit

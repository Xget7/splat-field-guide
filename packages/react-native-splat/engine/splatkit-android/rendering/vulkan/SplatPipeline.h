#pragma once

#include <array>
#include <cstdint>
#include <memory>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/FrameLoop.h"
#include "rendering/vulkan/GpuBuffer.h"
#include "rendering/vulkan/VulkanContext.h"
#include "rendering/vulkan/VulkanShaderTypes.h"
#include "splat/core/Result.h"
#include "splat/formats/SplatCloud.h"
#include "splat/math/Mat4.h"
#include "splat/math/Vec3.h"
#include "splatkit/rendering/GpuLayout.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

struct GpuWorld {
  std::unique_ptr<GpuBuffer> splats;
  std::unique_ptr<GpuBuffer> order;
  // SH uses channel-first pairs of halves with uint-aligned splats; degree zero retains a one-uint
  // placeholder for a valid unused descriptor.
  std::unique_ptr<GpuBuffer> sh;
  int shDegree = 0;
  uint32_t count = 0;
};

// Splats blend back to front without depth testing; each in-flight frame owns a camera uniform.
class SplatPipeline {
 public:
  static splat::Result<std::unique_ptr<SplatPipeline>> create(const VulkanContext& ctx,
                                                              VkRenderPass renderPass,
                                                              bool swapchainIsSrgb);
  ~SplatPipeline();

  SplatPipeline(const SplatPipeline&) = delete;
  SplatPipeline& operator=(const SplatPipeline&) = delete;

  // Blocking uploads drop SH above maxShDegree; degree 3 uses 92 SH bytes per splat.
  std::unique_ptr<GpuWorld> uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) const;
  void bindWorld(const GpuWorld& world);

  // Update after the slot fence and before compute/draw; borrowed uniforms live with the pipeline
  // and order buffers must remain alive and cover capacity uints.
  VkBuffer updateCamera(uint32_t frameSlot, const SplatRenderer::Frame& frame, VkExtent2D extent);
  void bindOrder(uint32_t frameSlot, VkBuffer order, uint32_t capacity);
  void drawIndirect(VkCommandBuffer cmd, uint32_t frameSlot, const GpuWorld& world, int shDegree,
                    VkBuffer arguments);

  static constexpr int kMaxShDegree = 3;

 private:
  explicit SplatPipeline(const VulkanContext& ctx) : ctx_(ctx) {}
  bool createDescriptors();
  bool createPipelines(VkRenderPass renderPass);
  void bindDraw(VkCommandBuffer cmd, uint32_t frameSlot, const GpuWorld& world, int shDegree) const;

  const VulkanContext& ctx_;
  bool outputLinear_ = true;
  VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
  VkDescriptorPool pool_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, FrameLoop::kFramesInFlight> sets_{};
  std::array<std::unique_ptr<GpuBuffer>, FrameLoop::kFramesInFlight> uniforms_{};
  VkPipelineLayout layout_ = VK_NULL_HANDLE;
  // One pipeline per SH degree, specialised so degree 0 worlds pay nothing for SH.
  std::array<VkPipeline, kMaxShDegree + 1> pipelines_{};
};

}

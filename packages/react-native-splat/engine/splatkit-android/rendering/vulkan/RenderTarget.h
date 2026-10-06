#pragma once

#include <memory>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/VulkanContext.h"
#include "splat/core/Result.h"

namespace splatkit {

// Offscreen scaling reduces blended fragment cost and uses the swapchain format to preserve
// render-pass pipeline compatibility.
class RenderTarget {
 public:
  static splat::Result<std::unique_ptr<RenderTarget>> create(const VulkanContext& ctx,
                                                             VkFormat format, VkExtent2D extent);
  ~RenderTarget();

  RenderTarget(const RenderTarget&) = delete;
  RenderTarget& operator=(const RenderTarget&) = delete;

  VkExtent2D extent() const { return extent_; }
  VkRenderPass renderPass() const { return renderPass_; }
  VkFormat format() const { return format_; }
  VkFramebuffer framebuffer() const { return framebuffer_; }

  // After the pass leaves a transfer source, record the upscale and transition the swapchain image
  // for presentation.
  void blitTo(VkCommandBuffer cmd, VkImage swapchainImage, VkExtent2D swapchainExtent) const;

 private:
  explicit RenderTarget(const VulkanContext& ctx) : ctx_(ctx) {}

  const VulkanContext& ctx_;
  VkExtent2D extent_{};
  VkFormat format_ = VK_FORMAT_UNDEFINED;
  VkImage image_ = VK_NULL_HANDLE;
  VmaAllocation allocation_ = VK_NULL_HANDLE;
  VkImageView view_ = VK_NULL_HANDLE;
  VkRenderPass renderPass_ = VK_NULL_HANDLE;
  VkFramebuffer framebuffer_ = VK_NULL_HANDLE;
};

}

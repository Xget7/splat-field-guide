#pragma once

#include <memory>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/VulkanContext.h"
#include "splat/core/Result.h"

namespace splatkit {

// An offscreen colour image the splats are drawn into when the render scale is below
// one, then blitted up to the swapchain. Splat rendering is bound by blended fragments,
// so pixels are the one lever that scales the cost directly; the blit is nearly free.
// The render pass has the swapchain's format, so the pipelines built against the
// swapchain pass are compatible with it.
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

  // Records the upscale into `swapchainImage`, which is left ready for presentation.
  // Call after the render pass ended; the pass leaves the image as a transfer source.
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

}  // namespace splatkit

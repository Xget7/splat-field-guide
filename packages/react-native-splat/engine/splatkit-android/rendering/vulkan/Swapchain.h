#pragma once

#include <memory>
#include <vector>

#include <vulkan/vulkan.h>
// After vulkan.h on purpose: VkBootstrap.h would otherwise hide the prototypes.
#include <VkBootstrap.h>

#include "rendering/vulkan/VulkanContext.h"
#include "splat/core/Result.h"

namespace splatkit {

// Recreate images when the surface resizes and destroy them on detach; FIFO is the guaranteed vsync
// mode.
class Swapchain {
 public:
  // Disabling vsync requests immediate or mailbox presentation to measure GPU cost without vsync
  // quantization.
  static splat::Result<std::unique_ptr<Swapchain>> create(const VulkanContext& ctx,
                                                          VkSurfaceKHR surface,
                                                          VkSwapchainKHR previous, bool vsync,
                                                          bool linearBlending);
  ~Swapchain();

  Swapchain(const Swapchain&) = delete;
  Swapchain& operator=(const Swapchain&) = delete;

  VkSwapchainKHR handle() const { return swapchain_.swapchain; }
  VkRenderPass renderPass() const { return renderPass_; }
  VkFormat format() const { return swapchain_.image_format; }
  VkExtent2D extent() const { return swapchain_.extent; }
  VkImage image(uint32_t index) const { return images_[index]; }
  uint32_t imageCount() const { return static_cast<uint32_t>(framebuffers_.size()); }
  VkFramebuffer framebuffer(uint32_t imageIndex) const { return framebuffers_[imageIndex]; }

  // Detaches the VkSwapchainKHR so a successor can be built from it. The caller owns it.
  VkSwapchainKHR release();

 private:
  explicit Swapchain(const VulkanContext& ctx) : ctx_(ctx) {}
  splat::Result<splat::Ok> createRenderPass();
  splat::Result<splat::Ok> createFramebuffers();

  const VulkanContext& ctx_;
  vkb::Swapchain swapchain_{};
  std::vector<VkImage> images_;
  std::vector<VkImageView> imageViews_;
  VkRenderPass renderPass_ = VK_NULL_HANDLE;
  std::vector<VkFramebuffer> framebuffers_;
};

}

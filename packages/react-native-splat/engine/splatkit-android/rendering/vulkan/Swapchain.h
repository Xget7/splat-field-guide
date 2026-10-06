#pragma once

#include <memory>
#include <vector>

#include <vulkan/vulkan.h>
// After vulkan.h on purpose: VkBootstrap.h would otherwise hide the prototypes.
#include <VkBootstrap.h>

#include "rendering/vulkan/VulkanContext.h"
#include "splat/core/Result.h"

namespace splatkit {

// The images that go to the screen, plus the render pass and one framebuffer per image.
// Recreated whenever the surface changes size; destroyed whenever the surface goes away.
// FIFO (vsync) is the default: the one mode Vulkan guarantees and the one that saves battery.
class Swapchain {
 public:
  // `vsync` false asks for an uncapped present mode (immediate, else mailbox) so that
  // frame times reflect GPU cost instead of vsync multiples; benchmarks use it.
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

}  // namespace splatkit

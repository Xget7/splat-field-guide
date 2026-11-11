#pragma once

#include <memory>
#include <vector>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanContext.h"
#include "splat/core/Result.h"

namespace splatkit {

// The images that go to the screen, plus the render pass and one framebuffer per image.
// Recreated whenever the surface changes size or rotation; destroyed whenever the surface
// goes away. FIFO (vsync) is the default: the one mode Vulkan guarantees and the one that
// saves battery.
//
// Pre-rotated: the images have the display's native orientation and the frame is drawn
// turned by the display's rotation, so the compositor scans them out as they are. With an
// identity transform on a rotated display, Android composites the layer on the GPU every
// frame (CLIENT composition, ROT_90 on the Mi 9).
class VulkanSwapchain {
 public:
  // `vsync` false asks for an uncapped present mode (immediate, else mailbox) so that
  // frame times reflect GPU cost instead of vsync multiples; benchmarks use it.
  static splat::Result<std::unique_ptr<VulkanSwapchain>> create(const VulkanContext& ctx,
                                                                VkSurfaceKHR surface,
                                                                VkSwapchainKHR previous, bool vsync,
                                                                bool linearBlending);
  ~VulkanSwapchain();

  VulkanSwapchain(const VulkanSwapchain&) = delete;
  VulkanSwapchain& operator=(const VulkanSwapchain&) = delete;

  VkSwapchainKHR handle() const { return swapchain_; }
  VkRenderPass renderPass() const { return renderPass_; }
  VkFormat format() const { return format_; }
  // The images' size, in the display's native orientation: framebuffers, viewport, blits.
  VkExtent2D extent() const { return extent_; }
  // The window's size, in the orientation the user sees: camera, culling, size checks.
  VkExtent2D windowExtent() const;
  VkSurfaceTransformFlagBitsKHR transform() const { return transform_; }
  // Clockwise quarter turns, 0 to 3, the vertex stage applies to clip space.
  uint32_t quarterTurns() const { return quarterTurns_; }
  VkImage image(uint32_t index) const { return images_[index]; }
  uint32_t imageCount() const { return static_cast<uint32_t>(framebuffers_.size()); }
  VkFramebuffer framebuffer(uint32_t imageIndex) const { return framebuffers_[imageIndex]; }

  // The pre-transform a swapchain takes on a display with `current`: the rotation itself,
  // or identity for a mirrored transform, which is left to the compositor.
  static VkSurfaceTransformFlagBitsKHR preTransformFor(VkSurfaceTransformFlagBitsKHR current);

  // Detaches the VkSwapchainKHR so a successor can be built from it. The caller owns it.
  VkSwapchainKHR release();

 private:
  explicit VulkanSwapchain(const VulkanContext& ctx) : ctx_(ctx) {}
  splat::Result<splat::Ok> createImageViews();
  splat::Result<splat::Ok> createRenderPass();
  splat::Result<splat::Ok> createFramebuffers();

  const VulkanContext& ctx_;
  VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
  VkFormat format_ = VK_FORMAT_UNDEFINED;
  VkPresentModeKHR presentMode_ = VK_PRESENT_MODE_FIFO_KHR;
  VkExtent2D extent_{};
  VkSurfaceTransformFlagBitsKHR transform_ = VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR;
  uint32_t quarterTurns_ = 0;
  std::vector<VkImage> images_;
  std::vector<VkImageView> imageViews_;
  VkRenderPass renderPass_ = VK_NULL_HANDLE;
  std::vector<VkFramebuffer> framebuffers_;
};

}  // namespace splatkit

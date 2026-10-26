#pragma once

#include <cstdint>
#include <functional>
#include <memory>

#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/presentation/SurfaceSizeWait.h"
#include "rendering/vulkan/presentation/VulkanFrameLoop.h"
#include "rendering/vulkan/presentation/VulkanRenderTarget.h"
#include "rendering/vulkan/presentation/VulkanSwapchain.h"

namespace splatkit {

// Everything between an ANativeWindow and the images a frame draws into: the window, the
// VkSurfaceKHR, the swapchain, the offscreen target a render scale needs, and the rules
// for rebuilding them. Survives losing and regaining the window. A rebuild that fails
// drops the surface and logs; the surface stays down until `attach` gets a different
// window. Every mutator returns false only for that case. Render thread only.
class VulkanSurface {
 public:
  static constexpr float kMinRenderScale = 0.1f;
  static constexpr float kMaxRenderScale = 2.0f;

  // `beforeTeardown` runs while the device is idle, before the target, swapchain and
  // surface are destroyed, so the owner can release what draws into them.
  VulkanSurface(VulkanContext& ctx, VulkanFrameLoop& frameLoop,
                std::function<void()> beforeTeardown);
  // The owner detaches first (`attach(nullptr)`), so `beforeTeardown` has run by then; the
  // codebase has no runtime asserts, so nothing checks it.
  ~VulkanSurface();

  VulkanSurface(const VulkanSurface&) = delete;
  VulkanSurface& operator=(const VulkanSurface&) = delete;

  // A new window (takes a reference) or nullptr when the surface is going away.
  bool attach(ANativeWindow* window);
  // The window changed size while staying attached. Rebuilds the swapchain at once when the
  // surface already reports that size; otherwise waits for it (see `rebuildPending`).
  bool resize(uint32_t width, uint32_t height);
  // Clamped to [kMinRenderScale, kMaxRenderScale]; below or above 1 draws offscreen.
  bool setRenderScale(float scale);
  // Flips the swapchain format.
  bool setLinearBlending(bool linear);
  bool setVsync(bool vsync);
  // Rebuilds the swapchain after a frame: always when out of date, when suboptimal because
  // the display turned, and when it is not the window's size once the surface reports the
  // window's size. Other statuses change nothing.
  bool rebuildIfChanged(VulkanFrameLoop::Status status);
  // For a rebuild the owner failed after the surface succeeded: logs and drops it.
  void drop();

  // True when `attach` and the rebuilds left a swapchain to draw into.
  bool ready() const { return swapchain_ != nullptr; }
  float renderScale() const { return renderScale_; }
  bool linearBlending() const { return linearBlending_; }
  // True while the swapchain is not the window's size. Android reports the new size only
  // after a frame is presented, so the owner keeps drawing until this turns false.
  bool rebuildPending() const;
  // Counts the rebuilds of the swapchain or the target.
  uint32_t generation() const { return generation_; }

  // Needs `ready()` from here on.
  const VulkanSwapchain& swapchain() const { return *swapchain_; }
  VkFormat activeFormat() const;
  VkRenderPass activeRenderPass() const;
  VkFramebuffer framebuffer(uint32_t imageIndex) const;
  // The target's size with a render scale, else the swapchain's; zero without a swapchain.
  // In the display's native orientation: the render pass, viewport and scissor.
  VkExtent2D drawExtent() const;
  // `drawExtent` in the window's orientation: the camera and everything sized in pixels.
  VkExtent2D viewExtent() const;
  // Clockwise quarter turns the frame is drawn with (VulkanSwapchain::quarterTurns).
  uint32_t quarterTurns() const;
  // Records the upscale into the swapchain image when a render scale is active.
  void blitIfScaled(VkCommandBuffer cmd, uint32_t imageIndex) const;

 private:
  bool createSurface();
  bool recreateSwapchain();
  bool createRenderTarget();
  bool rebuildOrDrop();
  bool rebuildWhenSurfaceReportsWindowSize();
  bool rotationChanged() const;
  void teardown();
  void destroySwapchainAndSurface();

  VulkanContext& ctx_;
  VulkanFrameLoop& frameLoop_;
  std::function<void()> beforeTeardown_;
  ANativeWindow* window_ = nullptr;
  SurfaceSizeWait sizeWait_;  // the size the swapchain must reach, and how long to wait for it
  VkSurfaceKHR surface_ = VK_NULL_HANDLE;
  std::unique_ptr<VulkanSwapchain> swapchain_;
  std::unique_ptr<VulkanRenderTarget> target_;  // only when renderScale_ != 1
  float renderScale_ = 1.0f;
  bool linearBlending_ = false;
  bool vsync_ = true;
  uint32_t generation_ = 0;
};

}  // namespace splatkit

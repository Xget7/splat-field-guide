#include "rendering/vulkan/presentation/VulkanSurface.h"

#include <algorithm>
#include <optional>
#include <utility>

#include <vulkan/vulkan_android.h>

#include "splatkit/Log.h"

namespace splatkit {

VulkanSurface::VulkanSurface(VulkanContext& ctx, VulkanFrameLoop& frameLoop,
                             std::function<void()> beforeTeardown)
    : ctx_(ctx), frameLoop_(frameLoop), beforeTeardown_(std::move(beforeTeardown)) {}

// The owner has detached by now, so nothing it owns draws into what is destroyed here.
VulkanSurface::~VulkanSurface() {
  ctx_.waitIdle();
  destroySwapchainAndSurface();
  if (window_ != nullptr) ANativeWindow_release(window_);
}

bool VulkanSurface::attach(ANativeWindow* window) {
  if (window == window_) return true;
  teardown();
  if (window_ != nullptr) {
    ANativeWindow_release(window_);
    window_ = nullptr;
  }
  if (window == nullptr) return true;

  ANativeWindow_acquire(window);
  window_ = window;
  sizeWait_.windowResized({static_cast<uint32_t>(std::max(0, ANativeWindow_getWidth(window))),
                           static_cast<uint32_t>(std::max(0, ANativeWindow_getHeight(window)))});
  if (!createSurface() || !recreateSwapchain()) {
    LOGE("could not attach to the surface");
    teardown();
    return false;
  }
  return true;
}

bool VulkanSurface::resize(uint32_t width, uint32_t height) {
  if (!swapchain_) return true;
  sizeWait_.windowResized({width, height});
  const VkExtent2D current = swapchain_->windowExtent();
  if (!sizeWait_.pending({current.width, current.height})) return true;
  LOGI("surface resized to %ux%u, swapchain was %ux%u", width, height, current.width,
       current.height);
  // Field Guide draws into a TextureView, whose producer keeps its old buffer size until told,
  // so the surface would keep reporting the old extent. Setting it first lets the rebuild
  // follow the view's size.
  if (width > 0 && height > 0 &&
      ANativeWindow_setBuffersGeometry(window_, static_cast<int32_t>(width),
                                       static_cast<int32_t>(height), 0) != 0) {
    drop();
    return false;
  }
  return rebuildWhenSurfaceReportsWindowSize();
}

bool VulkanSurface::setRenderScale(float scale) {
  scale = std::clamp(scale, kMinRenderScale, kMaxRenderScale);
  if (scale == renderScale_) return true;
  renderScale_ = scale;
  if (!swapchain_) return true;
  ctx_.waitIdle();
  if (createRenderTarget()) return true;
  drop();
  return false;
}

bool VulkanSurface::setLinearBlending(bool linear) {
  if (linear == linearBlending_) return true;
  linearBlending_ = linear;
  return !swapchain_ || rebuildOrDrop();
}

bool VulkanSurface::setVsync(bool vsync) {
  if (vsync == vsync_) return true;
  vsync_ = vsync;
  return !swapchain_ || rebuildOrDrop();
}

bool VulkanSurface::rebuildIfChanged(VulkanFrameLoop::Status status) {
  if (status == VulkanFrameLoop::Status::swapchainOutOfDate) return rebuildOrDrop();
  if (status == VulkanFrameLoop::Status::swapchainSuboptimal && rotationChanged()) {
    return rebuildOrDrop();
  }
  return !rebuildPending() || rebuildWhenSurfaceReportsWindowSize();
}

// A half turn keeps the window's size, so only the transform tells it apart.
bool VulkanSurface::rotationChanged() const {
  VkSurfaceCapabilitiesKHR caps{};
  if (vkGetPhysicalDeviceSurfaceCapabilitiesKHR(ctx_.physicalDevice(), surface_, &caps) !=
      VK_SUCCESS) {
    return false;
  }
  if (VulkanSwapchain::preTransformFor(caps.currentTransform) == swapchain_->transform()) {
    return false;
  }
  LOGI("display rotation changed: transform %d, swapchain %d", caps.currentTransform,
       swapchain_->transform());
  return true;
}

bool VulkanSurface::rebuildPending() const {
  if (!swapchain_) return false;
  const VkExtent2D current = swapchain_->windowExtent();
  return sizeWait_.pending({current.width, current.height});
}

// A rebuild that fails leaves nothing to draw into, so the surface is dropped and stays
// down until the host attaches a different window; the failure is logged.
void VulkanSurface::drop() {
  LOGE("rendering stopped until the surface comes back");
  teardown();
}

VkFormat VulkanSurface::activeFormat() const {
  return target_ ? target_->format() : swapchain_->format();
}

VkRenderPass VulkanSurface::activeRenderPass() const {
  return target_ ? target_->renderPass() : swapchain_->renderPass();
}

VkFramebuffer VulkanSurface::framebuffer(uint32_t imageIndex) const {
  return target_ ? target_->framebuffer() : swapchain_->framebuffer(imageIndex);
}

VkExtent2D VulkanSurface::drawExtent() const {
  if (target_) return target_->extent();
  if (swapchain_) return swapchain_->extent();
  return {0, 0};
}

VkExtent2D VulkanSurface::viewExtent() const {
  const VkExtent2D draw = drawExtent();
  return quarterTurns() % 2 == 1 ? VkExtent2D{draw.height, draw.width} : draw;
}

uint32_t VulkanSurface::quarterTurns() const {
  return swapchain_ ? swapchain_->quarterTurns() : 0;
}

void VulkanSurface::blitIfScaled(VkCommandBuffer cmd, uint32_t imageIndex) const {
  if (target_) target_->blitTo(cmd, swapchain_->image(imageIndex), swapchain_->extent());
}

bool VulkanSurface::createSurface() {
  VkAndroidSurfaceCreateInfoKHR info{VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR};
  info.window = window_;
  if (vkCreateAndroidSurfaceKHR(ctx_.instance(), &info, nullptr, &surface_) != VK_SUCCESS) {
    LOGE("vkCreateAndroidSurfaceKHR failed");
    return false;
  }
  if (!ctx_.supportsPresent(surface_)) {
    LOGE("graphics queue cannot present to this surface");
    return false;
  }
  return true;
}

// Viewport and scissor are dynamic, so a resize or rotation does not touch the owner's
// pipelines. A render pass with the same attachment format is compatible with the one
// they were built against (Vulkan 1.1, 8.2 "Render Pass Compatibility"). Only a format
// change, which also flips the sRGB output path, forces the owner to rebuild them; the
// owner compares `activeFormat()` after each call.
bool VulkanSurface::recreateSwapchain() {
  ++generation_;
  ctx_.waitIdle();
  const VkSwapchainKHR previous = swapchain_ ? swapchain_->release() : VK_NULL_HANDLE;
  swapchain_.reset();

  auto swapchain = VulkanSwapchain::create(ctx_, surface_, previous, vsync_, linearBlending_);
  if (previous != VK_NULL_HANDLE) vkDestroySwapchainKHR(ctx_.device(), previous, nullptr);
  if (!swapchain) {
    LOGE("%s", swapchain.error().message.c_str());
    return false;
  }
  swapchain_ = std::move(swapchain.value());
  if (!frameLoop_.onSwapchainCreated(*swapchain_)) return false;
  return createRenderTarget();
}

bool VulkanSurface::createRenderTarget() {
  ++generation_;
  target_.reset();
  if (renderScale_ == 1.0f) return true;
  const VkExtent2D full = swapchain_->extent();
  const VkExtent2D scaled{std::max(1u, static_cast<uint32_t>(full.width * renderScale_)),
                          std::max(1u, static_cast<uint32_t>(full.height * renderScale_))};
  auto target = VulkanRenderTarget::create(ctx_, swapchain_->format(), scaled);
  if (!target) {
    LOGE("%s", target.error().message.c_str());
    return false;
  }
  target_ = std::move(target.value());
  return true;
}

bool VulkanSurface::rebuildOrDrop() {
  if (recreateSwapchain()) return true;
  drop();
  return false;
}

// Until a frame is presented, the surface keeps reporting its old size after the window
// changed, and a swapchain built from that report is the old size again. So the rebuild
// waits for the report to match the window. A report that never matches ends the wait
// after `SurfaceSizeWait::kMaxStaleChecks` frames and the swapchain takes the size the
// surface gives.
bool VulkanSurface::rebuildWhenSurfaceReportsWindowSize() {
  VkSurfaceCapabilitiesKHR caps{};
  std::optional<SurfaceSizeWait::Size> reported;
  if (vkGetPhysicalDeviceSurfaceCapabilitiesKHR(ctx_.physicalDevice(), surface_, &caps) ==
      VK_SUCCESS) {
    reported = SurfaceSizeWait::Size{caps.currentExtent.width, caps.currentExtent.height};
  }
  switch (sizeWait_.check(reported)) {
    case SurfaceSizeWait::Step::wait:
      return true;
    case SurfaceSizeWait::Step::rebuild:
      LOGI("surface now reports %ux%u", caps.currentExtent.width, caps.currentExtent.height);
      return rebuildOrDrop();
    case SurfaceSizeWait::Step::giveUp:
      break;
  }
  const SurfaceSizeWait::Size window = sizeWait_.window();
  LOGW("surface still reports %ux%u, window is %ux%u; using the surface's size",
       caps.currentExtent.width, caps.currentExtent.height, window.width, window.height);
  if (!rebuildOrDrop()) return false;
  const VkExtent2D settled = swapchain_->windowExtent();
  sizeWait_.adopt({settled.width, settled.height});
  return true;
}

void VulkanSurface::teardown() {
  ctx_.waitIdle();
  if (beforeTeardown_) beforeTeardown_();
  destroySwapchainAndSurface();
}

void VulkanSurface::destroySwapchainAndSurface() {
  target_.reset();
  swapchain_.reset();
  if (surface_ != VK_NULL_HANDLE) {
    vkDestroySurfaceKHR(ctx_.instance(), surface_, nullptr);
    surface_ = VK_NULL_HANDLE;
  }
}

}  // namespace splatkit

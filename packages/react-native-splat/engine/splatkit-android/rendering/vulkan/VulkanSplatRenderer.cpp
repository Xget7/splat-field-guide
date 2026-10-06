#include "rendering/vulkan/VulkanSplatRenderer.h"

#include <algorithm>
#include <limits>

#include <vulkan/vulkan_android.h>

#include "rendering/vulkan/RadixSort.h"

#include "splatkit/Log.h"

namespace splatkit {
namespace {

bool isSrgb(VkFormat format) {
  return format == VK_FORMAT_R8G8B8A8_SRGB || format == VK_FORMAT_B8G8R8A8_SRGB;
}

}

std::unique_ptr<VulkanSplatRenderer> VulkanSplatRenderer::create() {
  auto context = VulkanContext::create();
  if (!context) { LOGE("%s", context.error().message.c_str()); return nullptr; }
  auto loop = std::make_unique<FrameLoop>(*context.value());
  if (!loop->valid()) return nullptr;
  return std::unique_ptr<VulkanSplatRenderer>(new VulkanSplatRenderer(
      std::move(context.value()), std::move(loop)));
}

VulkanSplatRenderer::VulkanSplatRenderer(std::unique_ptr<VulkanContext> context,
                                       std::unique_ptr<FrameLoop> loop)
    : context_(std::move(context)), loop_(std::move(loop)), ctx_(*context_), frameLoop_(*loop_) {}

VulkanSplatRenderer::~VulkanSplatRenderer() {
  setWindow(nullptr);
  ctx_.waitIdle();
  world_.reset();
}

void VulkanSplatRenderer::setWindow(ANativeWindow* window) {
  if (window == window_) return;
  destroySurface();
  if (window_ != nullptr) {
    ANativeWindow_release(window_);
    window_ = nullptr;
  }
  if (window == nullptr) return;

  ANativeWindow_acquire(window);
  window_ = window;
  if (!createSurface() || !recreateSwapchain()) {
    LOGE("could not attach to the surface");
    failed_ = true;
    destroySurface();
  }
}

void VulkanSplatRenderer::onSurfaceResized(uint32_t width, uint32_t height) {
  if (!swapchain_ || width == 0 || height == 0) return;
  const VkExtent2D current = swapchain_->extent();
  if (current.width == width && current.height == height) return;
  LOGI("surface resized to %ux%u, swapchain was %ux%u", width, height, current.width,
       current.height);
  // Set producer buffer size before querying swapchain capabilities so projection follows
  // TextureView resizing.
  if (ANativeWindow_setBuffersGeometry(window_, width, height, 0) != 0) {
    keepSurfaceIf(false);
    return;
  }
  keepSurfaceIf(recreateSwapchain());
}

void VulkanSplatRenderer::setRenderScale(float scale) {
  scale = std::clamp(scale, 0.1f, 2.0f);
  if (scale == renderScale_) return;
  renderScale_ = scale;
  if (!swapchain_) return;
  ctx_.waitIdle();
  if (!createRenderTarget()) {
    keepSurfaceIf(false);
    return;
  }
  if (pipelineFormat_ != activeFormat()) keepSurfaceIf(createPipelines());
}

Extent VulkanSplatRenderer::drawExtent() const {
  VkExtent2D extent{0, 0};
  if (target_) {
    extent = target_->extent();
  } else if (swapchain_) {
    extent = swapchain_->extent();
  }
  return {extent.width, extent.height};
}

std::optional<GpuWorldInfo> VulkanSplatRenderer::world() const {
  if (!world_) return std::nullopt;
  return GpuWorldInfo{world_->count, world_->shDegree};
}

bool VulkanSplatRenderer::uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) {
  if (!splats_ || cloud.count() > std::numeric_limits<uint32_t>::max()) return false;
  ctx_.waitIdle();
  auto compute = VulkanFrameCompute::create(ctx_, static_cast<uint32_t>(cloud.count()));
  if (!compute) {
    LOGE("world requires GPU visibility/sort: %s",
         compute.error().message.c_str());
    return false;
  }
  auto world = splats_->uploadWorld(cloud, maxShDegree);
  if (!world) return false;
  ctx_.waitIdle();  // the previous world may still be in flight
  world_ = std::move(world);
  compute_ = compute ? std::move(compute.value()) : nullptr;
  splats_->bindWorld(*world_);
  worldFrameCompletion_.reset();
  return true;
}

bool VulkanSplatRenderer::draw(const Frame& frame) {
  if (!ready()) return false;
  uint32_t imageIndex = 0;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  FrameLoop::Status status = frameLoop_.beginFrame(*swapchain_, imageIndex, cmd);
  if (status == FrameLoop::Status::swapchainOutOfDate) {
    keepSurfaceIf(recreateSwapchain());
    return false;
  }
  if (status != FrameLoop::Status::ok) { failed_ = true; return false; }

  const Extent size = drawExtent();
  const VkExtent2D extent{size.width, size.height};
  const uint32_t slot = frameLoop_.currentSlot();
  // Outside the render pass: transfers are not allowed inside one.
  std::optional<VulkanFrameCompute::Draw> gpuDraw;
  if (world_ && compute_) {
    const VkBuffer camera =
        splats_->updateCamera(slot, frame, extent);
    gpuDraw = compute_->encode(cmd, slot, camera, *world_->splats, frame);
    if (gpuDraw)
      splats_->bindOrder(slot, gpuDraw->order, gpuDraw->capacity);
    else {
      failed_ = true;
      LOGE("GPU frame encode failed; submitting clear frame to preserve fence lifecycle");
    }
  }

  VkClearValue clear{};
  clear.color = {{0.0f, 0.0f, 0.0f, 1.0f}};
  VkRenderPassBeginInfo pass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
  pass.renderPass = activeRenderPass();
  pass.framebuffer = target_ ? target_->framebuffer() : swapchain_->framebuffer(imageIndex);
  pass.renderArea.extent = extent;
  pass.clearValueCount = 1;
  pass.pClearValues = &clear;
  vkCmdBeginRenderPass(cmd, &pass, VK_SUBPASS_CONTENTS_INLINE);

  // Negative height flips Y so that +Y is up, as in every other API we target.
  const VkViewport viewport{0.0f,
                            static_cast<float>(extent.height),
                            static_cast<float>(extent.width),
                            -static_cast<float>(extent.height),
                            0.0f,
                            1.0f};
  const VkRect2D scissor{{0, 0}, extent};
  vkCmdSetViewport(cmd, 0, 1, &viewport);
  vkCmdSetScissor(cmd, 0, 1, &scissor);

  if (world_ && gpuDraw) {
    splats_->drawIndirect(cmd, slot, *world_, frame.shDegree, gpuDraw->arguments);

  }

  vkCmdEndRenderPass(cmd);
  if (target_) target_->blitTo(cmd, swapchain_->image(imageIndex), swapchain_->extent());

  const uint64_t submittedBefore = frameLoop_.lastSubmission();
  status = frameLoop_.endFrame(*swapchain_, imageIndex);
  if (status == FrameLoop::Status::error) failed_ = true;
  if (gpuDraw && frameLoop_.lastSubmission() != submittedBefore)
    compute_->submitted(slot, frameLoop_.lastSubmission());
  const bool drewWorld = world_ && gpuDraw.has_value();
  if (drewWorld &&
      (status == FrameLoop::Status::ok || status == FrameLoop::Status::swapchainSuboptimal)) {
    worldFrameCompletion_.submitted(frameLoop_.lastSubmission());
  }
  if (status == FrameLoop::Status::swapchainOutOfDate ||
      (status == FrameLoop::Status::swapchainSuboptimal && surfaceExtentChanged())) {
    keepSurfaceIf(recreateSwapchain());
  }
  return true;
}

void VulkanSplatRenderer::collectCompletedFrames() const {
  const uint64_t completed = frameLoop_.completedSubmission();
  if (compute_) compute_->collectCompleted(completed);
}

bool VulkanSplatRenderer::createSurface() {
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

bool VulkanSplatRenderer::recreateSwapchain() {
  ++generation_;
  ctx_.waitIdle();
  const VkSwapchainKHR previous = swapchain_ ? swapchain_->release() : VK_NULL_HANDLE;
  swapchain_.reset();

  auto swapchain = Swapchain::create(ctx_, surface_, previous, vsync_, linearBlending_);
  if (previous != VK_NULL_HANDLE) vkDestroySwapchainKHR(ctx_.device(), previous, nullptr);
  if (!swapchain) {
    LOGE("%s", swapchain.error().message.c_str());
    return false;
  }
  swapchain_ = std::move(swapchain.value());
  if (!frameLoop_.onSwapchainCreated(*swapchain_)) return false;
  if (!createRenderTarget()) return false;

  // Dynamic viewport/scissor and render-pass compatibility preserve pipelines across resize;
  // attachment format changes require a rebuild.
  if (splats_ && pipelineFormat_ == activeFormat()) return true;
  return createPipelines();
}

bool VulkanSplatRenderer::createRenderTarget() {
  ++generation_;
  target_.reset();
  if (renderScale_ == 1.0f) return true;
  const VkExtent2D full = swapchain_->extent();
  const VkExtent2D scaled{std::max(1u, static_cast<uint32_t>(full.width * renderScale_)),
                          std::max(1u, static_cast<uint32_t>(full.height * renderScale_))};
  auto target = RenderTarget::create(ctx_, swapchain_->format(), scaled);
  if (!target) {
    LOGE("%s", target.error().message.c_str());
    return false;
  }
  target_ = std::move(target.value());
  return true;
}

bool VulkanSplatRenderer::createPipelines() {
  splats_.reset();
  pipelineFormat_ = activeFormat();
  const VkRenderPass pass = activeRenderPass();
  LOGI("pipelines for format %d, offscreen %d", static_cast<int>(pipelineFormat_), target_ ? 1 : 0);

  auto splats = SplatPipeline::create(ctx_, pass, isSrgb(pipelineFormat_));
  if (!splats) {
    LOGE("%s", splats.error().message.c_str());
    return false;
  }
  splats_ = std::move(splats.value());
  if (world_) splats_->bindWorld(*world_);
  return true;
}

void VulkanSplatRenderer::keepSurfaceIf(bool rebuilt) {
  if (rebuilt) return;
  failed_ = true;
  LOGE("surface rebuild failed");
  destroySurface();
}

// Only changed extents justify rebuilding for SUBOPTIMAL; identity pre-transform can report it
// permanently at the same size.
bool VulkanSplatRenderer::surfaceExtentChanged() const {
  VkSurfaceCapabilitiesKHR caps{};
  if (vkGetPhysicalDeviceSurfaceCapabilitiesKHR(ctx_.physicalDevice(), surface_, &caps) !=
      VK_SUCCESS) {
    return false;
  }
  const VkExtent2D current = swapchain_->extent();
  const bool changed =
      caps.currentExtent.width != current.width || caps.currentExtent.height != current.height;
  if (changed) {
    LOGI("surface is now %ux%u, swapchain was %ux%u", caps.currentExtent.width,
         caps.currentExtent.height, current.width, current.height);
  }
  return changed;
}

VkFormat VulkanSplatRenderer::activeFormat() const {
  return target_ ? target_->format() : swapchain_->format();
}

VkRenderPass VulkanSplatRenderer::activeRenderPass() const {
  return target_ ? target_->renderPass() : swapchain_->renderPass();
}

void VulkanSplatRenderer::destroySurface() {
  ctx_.waitIdle();
  splats_.reset();
  target_.reset();
  swapchain_.reset();
  if (surface_ != VK_NULL_HANDLE) {
    vkDestroySurfaceKHR(ctx_.instance(), surface_, nullptr);
    surface_ = VK_NULL_HANDLE;
  }
}

}

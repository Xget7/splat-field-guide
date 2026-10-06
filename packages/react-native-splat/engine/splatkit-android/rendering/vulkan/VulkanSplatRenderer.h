#pragma once

#include <cstdint>
#include <memory>

#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/FrameLoop.h"
#include "rendering/vulkan/RenderTarget.h"
#include "rendering/vulkan/SplatPipeline.h"
#include "rendering/vulkan/Swapchain.h"
#include "rendering/vulkan/VulkanContext.h"
#include "rendering/vulkan/VulkanFrameCompute.h"
#include "rendering/vulkan/WorldFrameCompletion.h"
#include "splat/formats/SplatCloud.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

// The GPU world survives surface replacement and rotation. Render thread only.
class VulkanSplatRenderer final : public SplatRenderer {
 public:
  static std::unique_ptr<VulkanSplatRenderer> create();
  ~VulkanSplatRenderer() override;

  VulkanSplatRenderer(const VulkanSplatRenderer&) = delete;
  VulkanSplatRenderer& operator=(const VulkanSplatRenderer&) = delete;

  // A new window (takes a reference) or nullptr when the surface is going away.
  void setWindow(ANativeWindow* window);
  void onSurfaceResized(uint32_t width, uint32_t height);

  void setRenderScale(float scale) override;
  float renderScale() const override { return renderScale_; }
  bool ready() const override { return swapchain_ && splats_; }
  Extent drawExtent() const override;
  uint32_t generation() const override { return generation_; }

  // Uploads once the GPU is done with the previous world. Needs `ready()`.
  bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) override;
  std::optional<GpuWorldInfo> world() const override;

  bool draw(const Frame& frame) override;
  bool failed() const override {
    collectCompletedFrames();
    return failed_ || frameLoop_.failed() || (compute_ && compute_->stats().status != 0);
  }
  bool hasCompletedWorldFrame() const override {
    return worldFrameCompletion_.completed(frameLoop_.completedSubmission());
  }
  // Collect completed GPU stats once per vsync, including idle frames with no later encode to read
  // them.
  void collectCompletedFrames() const;
  double lastGpuMillis() const override { return frameLoop_.lastGpuMillis(); }
  double lastSortMillis() const override { return compute_ ? compute_->stats().sortMillis : 0; }
  uint32_t lastDrawCount() const override { return compute_ ? compute_->stats().drawn : 0; }
  const std::string& deviceDescription() const override { return ctx_.deviceDescription(); }

 private:
  VulkanSplatRenderer(std::unique_ptr<VulkanContext> context, std::unique_ptr<FrameLoop> loop);
  bool createSurface();
  bool recreateSwapchain();
  bool createRenderTarget();
  bool createPipelines();
  void keepSurfaceIf(bool rebuilt);
  bool surfaceExtentChanged() const;
  VkFormat activeFormat() const;
  VkRenderPass activeRenderPass() const;
  void destroySurface();

  std::unique_ptr<VulkanContext> context_;
  std::unique_ptr<FrameLoop> loop_;
  VulkanContext& ctx_;
  FrameLoop& frameLoop_;
  ANativeWindow* window_ = nullptr;
  VkSurfaceKHR surface_ = VK_NULL_HANDLE;
  std::unique_ptr<Swapchain> swapchain_;
  std::unique_ptr<RenderTarget> target_;  // only when renderScale_ != 1
  std::unique_ptr<SplatPipeline> splats_;
  VkFormat pipelineFormat_ = VK_FORMAT_UNDEFINED;  // the format the pipelines target
  std::unique_ptr<GpuWorld> world_;
  std::unique_ptr<VulkanFrameCompute> compute_;
  float renderScale_ = 1.0f;
  bool linearBlending_ = false;
  bool vsync_ = true;
  bool failed_ = false;
  uint32_t generation_ = 0;
  mutable WorldFrameCompletion worldFrameCompletion_;
};

}

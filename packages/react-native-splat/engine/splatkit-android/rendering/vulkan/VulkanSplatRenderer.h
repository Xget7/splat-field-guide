#pragma once

#include <cstdint>
#include <memory>

#include <android/native_window.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/frame/VulkanCameraUniforms.h"
#include "rendering/vulkan/frame/VulkanFrameCompute.h"
#include "rendering/vulkan/presentation/VulkanFrameLoop.h"
#include "rendering/vulkan/presentation/VulkanSurface.h"
#include "rendering/vulkan/presentation/WorldFrameCompletion.h"
#include "rendering/vulkan/raster/VulkanSplatPipeline.h"
#include "rendering/vulkan/world/VulkanWorld.h"
#include "splat/formats/SplatCloud.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

// The SplatRenderer behind an ANativeWindow: the frame script, the pipelines built for the
// VulkanSurface's format and the world bound to them. Survives losing and regaining the
// window, and the world stays through it. A rebuild that fails drops the surface and logs;
// the view stays blank until the host attaches a surface again. Render thread only.
class VulkanSplatRenderer final : public SplatRenderer {
 public:
  VulkanSplatRenderer(VulkanContext& ctx, VulkanFrameLoop& frameLoop);
  ~VulkanSplatRenderer() override;

  VulkanSplatRenderer(const VulkanSplatRenderer&) = delete;
  VulkanSplatRenderer& operator=(const VulkanSplatRenderer&) = delete;

  // A new window (takes a reference) or nullptr when the surface is going away.
  void setWindow(ANativeWindow* window);
  // The window changed size while staying attached. Rebuilds the swapchain if needed.
  void onSurfaceResized(uint32_t width, uint32_t height);

  void setRenderScale(float scale) override;
  float renderScale() const override { return surface_.renderScale(); }
  // Flips the swapchain format.
  void setLinearBlending(bool linear) override;
  bool linearBlending() const override { return surface_.linearBlending(); }
  void setVsync(bool vsync) override;

  DeviceCapabilities deviceCapabilities() const override;
  bool applyRenderPolicy(const RenderPolicy& policy, std::string* reason) override;

  // True when a surface with pipelines is up.
  bool ready() const override { return surface_.ready() && splats_; }
  // The target's size with a render scale, else the swapchain's.
  Extent drawExtent() const override;
  // Counts the rebuilds of the swapchain or the target.
  uint32_t generation() const override { return surface_.generation(); }
  bool surfaceRebuildPending() const override { return surface_.rebuildPending(); }

  // Uploads once the GPU is done with the previous world. Needs `ready()`.
  bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) override;
  bool selectsLodOnGpu() const override;
  bool uploadLodWorld(const splat::LodTree& tree, int maxShDegree, uint32_t budget) override;
  bool sortsOnGpu() const override;
  bool createSlab(uint32_t capacity, int shDegree) override;
  bool uploadTile(uint32_t offset, const splat::SplatCloud& cloud) override;
  std::optional<GpuWorldInfo> world() const override;

  // The world, or only the clear colour without one.
  bool draw(const Frame& frame) override;
  uint64_t submittedFrames() const override { return frameLoop_.lastSubmission(); }
  uint64_t completedFrames() override { return frameLoop_.completedSubmission(); }
  bool hasCompletedWorldFrame() {
    return worldFrameCompletion_.completed(frameLoop_.completedSubmission());
  }
  // Reads the stats of frames the GPU finished, without waiting. Call once per vsync, drawn
  // or not: a still scene draws no later frame whose encode would read them.
  void collectCompletedFrames();
  double lastGpuMillis() const override { return frameLoop_.lastGpuMillis(); }
  double lastSortMillis() const override { return compute_ ? compute_->stats().sortMillis : 0; }
  double lastCullMillis() const override { return compute_ ? compute_->stats().cullMillis : 0; }
  double lastSelectMillis() const override { return compute_ ? compute_->stats().selectMillis : 0; }
  uint32_t lastDrawCount() const override { return compute_ ? compute_->stats().drawn : 0; }
  uint32_t lastSelectedCount() const override { return compute_ ? compute_->stats().selected : 0; }
  const std::string& deviceDescription() const override { return ctx_.deviceDescription(); }

 private:
  bool createPipelines();
  void rebuildPipelinesIfNeeded();
  void rebuildSurface(VulkanFrameLoop::Status status);
  void applyPolicyToCompute();
  // The frame compute pipelines, compiled by the first world load that needs them and kept for
  // every later one. Null when the device cannot run them.
  const VulkanFrameCompute::Pipelines* computePipelines();
  splat::Result<std::unique_ptr<VulkanFrameCompute>> createCompute(
      uint32_t sourceCount, const splat::LodTree* tree = nullptr,
      uint32_t budget = VulkanLodSelection::kMaxBudget);
  void adoptWorld(std::unique_ptr<VulkanWorld> world, std::unique_ptr<VulkanFrameCompute> compute);

  VulkanContext& ctx_;
  VulkanFrameLoop& frameLoop_;
  VulkanSurface surface_;
  // Created with the first pipelines and kept, so a rebuilt pipeline binds the same buffers.
  std::unique_ptr<VulkanCameraUniforms> camera_;
  std::unique_ptr<VulkanSplatPipeline> splats_;
  VkFormat pipelineFormat_ = VK_FORMAT_UNDEFINED;  // the format the pipelines target
  std::unique_ptr<VulkanWorld> world_;
  std::optional<VulkanFrameCompute::Pipelines> computePipelines_;
  std::unique_ptr<VulkanFrameCompute> compute_;
  RenderPolicy policy_;
  WorldFrameCompletion worldFrameCompletion_;
};

}  // namespace splatkit

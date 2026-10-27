#pragma once

#include <algorithm>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit::test {

class FakeRenderer final : public SplatRenderer {
 public:
  ~FakeRenderer() override {
    if (onDestroyed) onDestroyed();
  }
  void setRenderScale(float scale) override { scale_ = scale; }
  float renderScale() const override { return scale_; }
  void setLinearBlending(bool linear) override { linear_ = linear; }
  bool linearBlending() const override { return linear_; }
  void setVsync(bool) override {}
  bool ready() const override { return isReady; }
  Extent drawExtent() const override { return extent; }
  uint32_t generation() const override { return surfaceGeneration; }
  bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) override {
    if (failUploads) return false;
    world_ =
        GpuWorldInfo{static_cast<uint32_t>(cloud.count()), std::min(cloud.shDegree, maxShDegree)};
    return true;
  }
  bool selectsLodOnGpu() const override { return gpuLodSelection; }
  bool uploadLodWorld(const splat::LodTree& tree, int maxShDegree, uint32_t budget) override {
    if (failUploads) return false;
    world_ = GpuWorldInfo{static_cast<uint32_t>(tree.nodeCount()),
                          std::min(tree.nodes.shDegree, maxShDegree)};
    uploadedBudget = budget;
    uploadedLabels = tree.nodes.labels;
    return true;
  }
  // Field Guide loads single file worlds only, so no test builds a slab.
  bool createSlab(uint32_t, int) override { return false; }
  bool uploadTile(uint32_t, const splat::SplatCloud&) override { return false; }
  std::optional<GpuWorldInfo> world() const override { return world_; }
  bool sortsOnGpu() const override { return gpuSort; }
  bool draw(const Frame& frame) override {
    last = frame;
    // Draw ranges are borrowed only for this call; assertions read the captured frame later.
    ranges_.clear();
    if (frame.rangeCount != 0) {
      ranges_.assign(frame.ranges, frame.ranges + frame.rangeCount);
    }
    last.ranges = ranges_.empty() ? nullptr : ranges_.data();
    ++frames;
    return true;
  }
  uint64_t submittedFrames() const override { return frames; }
  // While gpuFinished is false the GPU holds every frame submitted since; it then catches up.
  uint64_t completedFrames() override {
    if (gpuFailed) return 0;
    if (gpuFinished) completed_ = frames;
    return completed_;
  }
  bool failed() const override { return gpuFailed; }
  double lastGpuMillis() const override { return 0; }
  const std::string& deviceDescription() const override { return description_; }

  bool isReady = true;
  bool failUploads = false;
  bool gpuSort = true;
  bool gpuLodSelection = true;
  bool gpuFinished = true;
  bool gpuFailed = false;
  Extent extent{1000, 1000};
  uint32_t surfaceGeneration = 0;
  Frame last;
  uint32_t frames = 0;
  std::function<void()> onDestroyed;
  // What the last tree upload handed the GPU.
  uint32_t uploadedBudget = 0;
  std::vector<uint8_t> uploadedLabels;

 private:
  float scale_ = 1;
  bool linear_ = false;
  uint64_t completed_ = 0;
  std::vector<Range> ranges_;
  std::optional<GpuWorldInfo> world_;
  std::string description_ = "fake";
};

}  // namespace splatkit::test

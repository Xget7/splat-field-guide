#pragma once

#include <algorithm>
#include <optional>
#include <string>

#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit::test {

// Records what the engine asks of a platform renderer.
class FakeRenderer final : public SplatRenderer {
 public:
  void setRenderScale(float scale) override { scale_ = scale; }
  float renderScale() const override { return scale_; }
  bool ready() const override { return isReady; }
  Extent drawExtent() const override { return extent; }
  uint32_t generation() const override { return surfaceGeneration; }
  bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) override {
    if (failUploads) return false;
    world_ =
        GpuWorldInfo{static_cast<uint32_t>(cloud.count()), std::min(cloud.shDegree, maxShDegree)};
    return true;
  }
  std::optional<GpuWorldInfo> world() const override { return world_; }
  bool draw(const Frame& frame) override {
    last = frame;
    ++frames;
    return true;
  }
  bool hasCompletedWorldFrame() const override { return gpuFinished; }
  bool failed() const override { return gpuFailed; }
  double lastGpuMillis() const override { return 0; }
  const std::string& deviceDescription() const override { return description_; }

  bool isReady = true;
  bool failUploads = false;
  // What the GPU says of the current world's frames: finished, or failed for good.
  bool gpuFinished = true;
  bool gpuFailed = false;
  Extent extent{1000, 1000};
  uint32_t surfaceGeneration = 0;
  Frame last;
  uint32_t frames = 0;

 private:
  float scale_ = 1;
  std::optional<GpuWorldInfo> world_;
  std::string description_ = "fake";
};

}  // namespace splatkit::test

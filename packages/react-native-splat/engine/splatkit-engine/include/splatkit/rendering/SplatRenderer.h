#pragma once

#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <vector>

#include "splat/formats/SplatCloud.h"
#include "splat/math/Mat4.h"
#include "splat/math/Vec3.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {

struct Extent {
  uint32_t width = 0;
  uint32_t height = 0;
};

struct GpuWorldInfo {
  uint32_t count = 0;
  int shDegree = 0;
};

// Render-thread adapters own GPU drawing; their platform views attach and resize surfaces outside
// this interface.
class SplatRenderer {
 public:
  virtual ~SplatRenderer() = default;

  // Render scale [0.1, 2] uses an offscreen target and linear rescaling away from one.
  virtual void setRenderScale(float scale) = 0;
  virtual float renderScale() const = 0;

  // True when a surface is up: frames can be drawn and worlds uploaded.
  virtual bool ready() const = 0;
  virtual Extent drawExtent() const = 0;
  // A surface-generation change invalidates previously drawn frames.
  virtual uint32_t generation() const = 0;

  // Failed uploads preserve the previous world.
  virtual bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) = 0;
  virtual std::optional<GpuWorldInfo> world() const = 0;

  struct Frame {
    int shDegree = 0;  // capped by what the world carries
    splat::Mat4 view = splat::Mat4::identity();
    splat::Mat4 proj = splat::Mat4::identity();
    splat::Vec3 cameraPosition;
    // Null styles draw every splat as captured.
    const LabelStyles* labelStyles = nullptr;
    // The reveal clips above revealLevel and glows within revealBand below it; defaults disable the
    // sweep.
    float revealLevel = std::numeric_limits<float>::infinity();
    float revealBand = 0;
  };
  // False means nothing was presented, including when rebuilding the surface.
  virtual bool draw(const Frame& frame) = 0;

  // Any thread may query GPU completion of the current world; unsupported renderers return true so
  // the engine falls back to draw completion.
  virtual bool hasCompletedWorldFrame() const { return true; }
  // True once the GPU reported an error. The renderer draws nothing more.
  virtual bool failed() const { return false; }

  // GPU timestamps describe the last completed frame, or zero before completion and when
  // unsupported.
  virtual double lastGpuMillis() const = 0;
  // GPU time of the last completed cull and sort; zero when unavailable.
  virtual double lastSortMillis() const { return 0; }
  // Counts splats from the last completed frame.
  virtual uint32_t lastDrawCount() const { return 0; }
  // Reported display times use nanoseconds, oldest first since the last call, with the unseen
  // submission count returned.
  virtual bool reportsPresentTimes() const { return false; }
  virtual uint32_t takePresentTimes(std::vector<int64_t>* times) {
    times->clear();
    return 0;
  }
  virtual const std::string& deviceDescription() const = 0;
};

}

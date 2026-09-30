#pragma once

#include <cstdint>
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

// The world the renderer holds: `count` records, harmonics up to `shDegree`.
struct GpuWorldInfo {
  uint32_t count = 0;
  int shDegree = 0;
};

// What the engine needs from a platform's graphics API: a surface it can draw the
// world on, and a world it culls, sorts and draws on the GPU. Metal on iOS. Render
// thread only.
//
// Attaching and resizing the surface are platform calls made by the platform's own
// view code, so they are not part of this interface.
class SplatRenderer {
 public:
  virtual ~SplatRenderer() = default;

  // Fraction of the surface resolution the splats are drawn at, [0.1, 2]. Away from one
  // the frame is drawn offscreen and rescaled with a linear blit.
  virtual void setRenderScale(float scale) = 0;
  virtual float renderScale() const = 0;

  // True when a surface is up: frames can be drawn and worlds uploaded.
  virtual bool ready() const = 0;
  // Where the splats are drawn: the surface's size with the render scale applied.
  virtual Extent drawExtent() const = 0;
  // Counts the rebuilds of the surface's images. A frame drawn before one is gone.
  virtual uint32_t generation() const = 0;

  // Uploads a world and draws it from now on. Fails, keeping the previous world, when
  // the upload does.
  virtual bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) = 0;
  virtual std::optional<GpuWorldInfo> world() const = 0;

  struct Frame {
    int shDegree = 0;  // capped by what the world carries
    splat::Mat4 view = splat::Mat4::identity();
    splat::Mat4 proj = splat::Mat4::identity();
    splat::Vec3 cameraPosition;
    // How each part label is drawn; null draws every splat as captured.
    const LabelStyles* labelStyles = nullptr;
  };
  // Culls, sorts and draws the whole world, then presents. Returns false when nothing was
  // presented, e.g. the surface was rebuilt instead.
  virtual bool draw(const Frame& frame) = 0;

  // GPU time of the most recently completed frame, from timestamps at both ends of it.
  // Zero until the first frame completes or if unsupported.
  virtual double lastGpuMillis() const = 0;
  // GPU time of the last completed cull and sort; zero when unavailable.
  virtual double lastSortMillis() const { return 0; }
  // Splats the last completed frame drew.
  virtual uint32_t lastDrawCount() const { return 0; }
  // True when the renderer learns when frames reach the display. It then moves into `times`
  // the display times, in nanoseconds, of frames shown since the last call, oldest first,
  // and returns how many submitted frames were never shown.
  virtual bool reportsPresentTimes() const { return false; }
  virtual uint32_t takePresentTimes(std::vector<int64_t>* times) {
    times->clear();
    return 0;
  }
  // GPU name and API version, for a HUD.
  virtual const std::string& deviceDescription() const = 0;
};

}  // namespace splatkit

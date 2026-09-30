#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "splat/core/CoordinateFrame.h"
#include "splat/core/Result.h"
#include "splat/loading/SplatWorldLoader.h"
#include "splat/math/Mat4.h"
#include "splatkit/camera/OrbitCamera.h"
#include "splatkit/diagnostics/StatsPublisher.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

// The native engine behind one view. It owns the loader, the orbit camera and the
// platform's renderer and runs them once per vsync: a frame steps the camera and draws
// only when something visible changed, so a still scene costs no GPU time.
//
// Rendering, input and settings run on the render thread. Loading may run on any
// thread: it decodes there and leaves the result for the render thread to upload.
// The surface belongs to the renderer: the engine survives losing and regaining it.
class SplatEngine {
 public:
  explicit SplatEngine(std::unique_ptr<SplatRenderer> renderer);
  ~SplatEngine();

  SplatEngine(const SplatEngine&) = delete;
  SplatEngine& operator=(const SplatEngine&) = delete;

  // The platform's renderer, for the calls only its view makes: attaching a surface.
  SplatRenderer& renderer() { return *renderer_; }

  // Steps the camera and draws if anything visible changed. True when a frame was drawn.
  bool render(int64_t frameTimeNanos);

  // Decodes an SPZ world whose positions are in `sourceFrame`. Thread safe. Errors are
  // reported and leave the current world.
  void loadWorld(const std::uint8_t* data, std::size_t size, splat::CoordinateFrame sourceFrame);
  // The same from a file, mapped rather than copied through the host's heap.
  void loadWorldFile(const std::string& path, splat::CoordinateFrame sourceFrame);

  // What the host needs to know about loading. Ready fires on the render thread once the
  // world is drawn from; failures fire on whichever thread found them.
  enum class Event { worldReady = 0, worldFailed = 1 };
  using EventSink = std::function<void(Event, const std::string& message, uint32_t splatCount)>;
  void setEventSink(EventSink sink) { events_ = std::move(sink); }

  // Camera, on the render thread. Until the host sets a pose, each world loaded is framed
  // whole from the current direction, and framed again when the view changes shape.
  bool setCameraPose(const OrbitPose& pose);
  bool setCameraLimits(const OrbitLimits& limits);
  // Radians; a drag stops any framing animation.
  bool orbit(float deltaAzimuth, float deltaElevation);
  // A pinch's scale: above one moves closer.
  bool dolly(float factor);
  // Eases the camera over `seconds` until `bounds` fills the view, looking from where it
  // looks now.
  bool frame(const splat::Bounds& bounds, float seconds);
  const OrbitPose& cameraPose() const { return camera_.pose(); }

  // Fraction of the surface resolution the splats are drawn at, [0.1, 2]. Below one is
  // cheaper, which is what thermal pressure trades first. Render thread.
  void setRenderScale(float scale) { renderer_->setRenderScale(scale); }
  float renderScale() const { return renderer_->renderScale(); }

  // Highest spherical harmonics degree decoded and uploaded with the next world, 0 to 3.
  // Any thread.
  void setMaxShDegree(int degree) { loader_.setMaxShDegree(degree); }
  // Spherical harmonics degree drawn, 0 to 3, capped by what the loaded world carries.
  // Takes effect on the next frame. Render thread.
  void setShDegree(int degree);

  // Draws the next frame even when nothing changed, for a renderer that has something
  // to do with it, such as a capture.
  void requestRedraw() { redrawNeeded_ = true; }

  // Readable from any thread. Refreshed twice a second by the render loop, and by
  // publishStats.
  Stats stats() const { return stats_.stats(); }
  // Render thread: publishes the newest finished frame's counts and times now.
  void publishStats();
  const std::string& gpuDescription() const { return renderer_->deviceDescription(); }

  static constexpr float kFieldOfViewRadians = 65.0f * 3.14159265358979f / 180.0f;
  static constexpr float kNearPlane = 0.05f;
  static constexpr float kFarPlane = 200.0f;

 private:
  static constexpr int kMaxShDegree = 3;

  void emit(Event event, const std::string& message = {}, uint32_t splatCount = 0) const {
    if (events_) events_(event, message, splatCount);
  }
  void report(const splat::Result<splat::SplatWorldLoader::WorldReport>& report);
  bool applyPendingWorld();
  void reframeDefault(Extent extent);
  float frameSeconds(int64_t frameTimeNanos);
  splat::Mat4 projection(Extent extent) const;
  StatsPublisher::Sample sample() const;

  EventSink events_;
  std::unique_ptr<SplatRenderer> renderer_;
  splat::SplatWorldLoader loader_;
  OrbitCamera camera_;
  // The bounds the default framing fits and the view shape it was fitted to; empty once
  // the host places the camera itself.
  bool poseSet_ = false;
  std::optional<splat::Bounds> framedBounds_;
  Extent framedExtent_;
  StatsPublisher stats_;
  std::vector<int64_t> presentTimes_;

  int shDegree_ = kMaxShDegree;
  uint32_t sourceCount_ = 0;
  int64_t lastFrameNanos_ = 0;
  bool redrawNeeded_ = true;
  uint32_t lastDrawnGeneration_ = 0;
};

}  // namespace splatkit

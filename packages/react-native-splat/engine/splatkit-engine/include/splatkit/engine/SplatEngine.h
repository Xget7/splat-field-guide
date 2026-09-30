#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "splat/core/CoordinateFrame.h"
#include "splat/core/Result.h"
#include "splat/loading/SplatWorldLoader.h"
#include "splat/math/Mat4.h"
#include "splatkit/camera/OrbitCamera.h"
#include "splatkit/diagnostics/StatsPublisher.h"
#include "splatkit/highlight/Highlight.h"
#include "splatkit/pick/PickIndex.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

// The native engine behind one view. It owns the loader, the orbit camera, the highlight
// and the platform's renderer and runs them once per vsync: a frame steps the camera and
// the highlight's fade and draws only when something visible changed, so a still scene
// costs no GPU time.
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
  // Time stands still while the engine rests: what starts after it ran out of work starts
  // on the next frame, however long the host waited.
  bool render(int64_t frameTimeNanos);
  // Render thread: whether the next vsync has anything to do. False while the scene is still
  // and while there is no surface to draw on, so a host can stop its display link; any call
  // into the engine, a finished load or a new surface is a reason to start it again. Stats
  // stop ageing while it is stopped.
  bool needsFrame() const;

  // Decodes an SPZ world whose positions are in `sourceFrame`, with the labels.bin of its
  // part labels (empty for none). Thread safe. False when it failed, which is reported too
  // and leaves the current world.
  bool loadWorld(splat::ByteView spz, splat::ByteView labels, splat::CoordinateFrame sourceFrame);
  // The same from files, mapped rather than copied through the host's heap.
  bool loadWorldFile(const std::string& spzPath, const std::string& labelsPath,
                     splat::CoordinateFrame sourceFrame);

  // What the host needs to know about loading and the GPU. Ready fires on the render thread
  // once a frame of the new world has finished on the GPU, so it is on screen; failures fire
  // on whichever thread found them. Labels that do not fit the cloud are their own failure:
  // the capture is fine, the pack is not. A GPU failure is final for this engine.
  enum class Event { worldReady = 0, worldFailed = 1, labelsMismatch = 2, gpuFailed = 3 };
  using EventSink = std::function<void(Event, const std::string& message, uint32_t splatCount)>;
  void setEventSink(EventSink sink) { events_ = std::move(sink); }

  // Camera, on the render thread. Until the host places the camera, each world loaded is
  // framed whole from the current direction.
  bool setCameraPose(const OrbitPose& pose);
  bool setCameraLimits(const OrbitLimits& limits);
  // Radians; a drag stops any framing animation.
  bool orbit(float deltaAzimuth, float deltaElevation);
  // A pinch's scale: above one moves closer.
  bool dolly(float factor);
  // Where a framing looks from, in radians as an OrbitPose turns.
  struct ViewDirection {
    float azimuth = 0;
    float elevation = 0;
  };
  // Eases the camera over `seconds` until `bounds` fills the view, looking from `from` or
  // else from where it looks now. Until the view has a size it goes there at once. A framing
  // holds until a pinch or a pose replaces it: when the view changes shape it is fitted again.
  bool frame(const splat::Bounds& bounds, float seconds,
             std::optional<ViewDirection> from = std::nullopt);
  const OrbitPose& cameraPose() const { return camera_.pose(); }

  // Emphasises the parts with these labels and dims the rest, fading from the previous
  // highlight; no labels shows every splat as captured. Render thread.
  void setHighlight(const std::uint8_t* labels, std::size_t count);

  // Any thread: the label of the part at (x, y), in [0, 1] from the top left of the view,
  // in the frame last drawn; 0 for none. It casts against the whole cloud, milliseconds of
  // work, so it belongs on a worker thread rather than the render thread.
  std::uint8_t pick(float x, float y) const;
  // Any thread: where each world point (x, y, z) of `points` shows in the frame last drawn,
  // written to `out` as (x, y) in [0, 1] from the top left, NaN for a point behind the
  // camera. Returns how many are in front.
  std::size_t project(const float* points, std::size_t count, float* out) const;

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
  bool report(const splat::Result<splat::SplatWorldLoader::WorldReport>& report);
  bool applyPendingWorld();
  void refit(Extent extent);
  void reportShown();
  bool step(int64_t frameTimeNanos);
  float frameSeconds(int64_t frameTimeNanos);
  splat::Mat4 projection(Extent extent) const;
  StatsPublisher::Sample sample() const;
  void publishView(const SplatRenderer::Frame& frame);

  // What pick and project read from any thread: the last drawn frame's camera and world.
  struct View {
    splat::Mat4 view = splat::Mat4::identity();
    splat::Mat4 cameraToWorld = splat::Mat4::identity();
    float projX = 0;  // the projection's x and y scales
    float projY = 0;
    std::shared_ptr<const PickIndex> pickIndex;
  };
  View publishedView() const;

  EventSink events_;
  std::unique_ptr<SplatRenderer> renderer_;
  splat::SplatWorldLoader loader_;
  OrbitCamera camera_;
  Highlight highlight_;
  // The bounds the framing fits and the view shape it was fitted to, empty once a pinch or a
  // pose replaces it. Until the host places the camera, each world is framed whole.
  bool poseSet_ = false;
  std::optional<splat::Bounds> framedBounds_;
  Extent framedExtent_;
  StatsPublisher stats_;
  std::vector<int64_t> presentTimes_;
  // The uploaded world's pick index, published with the first frame drawn from it.
  std::shared_ptr<const PickIndex> pickIndex_;
  mutable std::mutex viewMutex_;
  std::optional<View> view_;

  // A world is on screen once drawn and then finished by the GPU; ready waits for both.
  enum class Showing { nothing, awaitingDraw, awaitingGpu };
  Showing showing_ = Showing::nothing;
  bool gpuFailureReported_ = false;

  int shDegree_ = kMaxShDegree;
  uint32_t sourceCount_ = 0;
  int64_t lastFrameNanos_ = 0;
  bool redrawNeeded_ = true;
  uint32_t lastDrawnGeneration_ = 0;
};

}  // namespace splatkit

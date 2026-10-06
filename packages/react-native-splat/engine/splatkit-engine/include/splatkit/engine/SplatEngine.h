#pragma once

#include <atomic>
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
#include "splatkit/reveal/Reveal.h"

namespace splatkit {

// Rendering, input and settings use the render thread; loading decodes on any thread for later
// upload, and the engine survives surface detachment.
class SplatEngine {
 public:
  struct LoadedWorld {
    std::unique_ptr<splat::SplatCloud> cloud;
    splat::SplatWorldLoader::WorldReport report;
  };
  using FileLoader = std::function<splat::Result<LoadedWorld>(
      const std::string&, const std::string&, splat::CoordinateFrame, int,
      const splat::SourceIdentity*)>;
  explicit SplatEngine(std::unique_ptr<SplatRenderer> renderer, FileLoader loadFile = {});
  ~SplatEngine();

  SplatEngine(const SplatEngine&) = delete;
  SplatEngine& operator=(const SplatEngine&) = delete;

  SplatRenderer& renderer() { return *renderer_; }

  // Idle time does not advance animations; newly scheduled work begins on the next frame.
  bool render(int64_t frameTimeNanos);
  // Render-thread hosts may sleep while idle or detached, freezing stats until input, load
  // completion or a new surface wakes them.
  bool needsFrame() const;

  // Thread-safe decoding reports errors without replacing the current world; empty labels mean no
  // parts.
  bool loadWorld(splat::ByteView spz, splat::ByteView labels, splat::CoordinateFrame sourceFrame);
  bool loadWorldFile(const std::string& spzPath, const std::string& labelsPath,
                     splat::CoordinateFrame sourceFrame);

  // Any thread may reserve a replacement; only the newest reservation can publish a cloud or report
  // an outcome.
  uint64_t beginLoad();
  bool loadWorldFile(uint64_t request, const std::string& spzPath, const std::string& labelsPath,
                     splat::CoordinateFrame sourceFrame,
                     const splat::SourceIdentity* identity = nullptr);

  // Ready reports from the render thread after GPU completion, failures report from their detecting
  // thread, and GPU failure is final.
  enum class Event { worldReady = 0, worldFailed = 1, labelsMismatch = 2, gpuFailed = 3 };
  using EventSink = std::function<void(Event, const std::string& message, uint32_t splatCount)>;
  void setEventSink(EventSink sink) { events_ = std::move(sink); }

  // Camera mutations use the render thread; unpositioned cameras frame each new world from the
  // current direction.
  bool setCameraPose(const OrbitPose& pose);
  bool setCameraLimits(const OrbitLimits& limits);
  // Radians; a drag stops any framing animation.
  bool orbit(float deltaAzimuth, float deltaElevation);
  // A pinch's scale: above one moves closer.
  bool dolly(float factor);
  // Framing directions use OrbitPose radians.
  struct ViewDirection {
    float azimuth = 0;
    float elevation = 0;
  };
  // Framing holds through size changes until a pinch or pose replaces it, with immediate placement
  // if the view has no size.
  bool frame(const splat::Bounds& bounds, float seconds,
             std::optional<ViewDirection> from = std::nullopt);
  const OrbitPose& cameraPose() const { return camera_.pose(); }

  // Render-thread highlights fade between label sets; empty labels show the cloud as captured.
  void setHighlight(const std::uint8_t* labels, std::size_t count);
  // Render-thread reveal duration uses seconds for a bottom-up sweep; zero shows the world
  // immediately.
  void setRevealSeconds(float seconds) { revealSeconds_ = seconds; }

  // Worker-thread picking reads the last drawn frame at normalized top-left xy, returns zero for no
  // part and may take milliseconds.
  std::uint8_t pick(float x, float y) const;
  // Any thread may project last-frame world xyz into normalized top-left xy, with NaN behind the
  // camera and the in-front count returned.
  std::size_t project(const float* points, std::size_t count, float* out) const;
  // Any thread: where the frame last drawn looks from, radians; false before the first.
  bool drawnDirection(float& azimuth, float& elevation) const;

  // Render scale is [0.1, 2] on the render thread; thermal pressure reduces resolution first.
  void setRenderScale(float scale) { renderer_->setRenderScale(scale); }
  float renderScale() const { return renderer_->renderScale(); }

  // Any thread may set the maximum SH degree for the next decode/upload, from 0 to 3.
  void setMaxShDegree(int degree) { maxShDegree_.store(degree); }
  // Render-thread SH degree changes apply next frame and clamp to the loaded degree.
  void setShDegree(int degree);

  // Force a frame for renderer work such as capture even when the scene is unchanged.
  void requestRedraw() { redrawNeeded_ = true; }

  // Any thread may read stats refreshed at 2 Hz or by publishStats.
  Stats stats() const { return stats_.stats(); }
  // Render-thread publication exposes the newest completed frame.
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
  bool finishLoad(uint64_t request, splat::Result<LoadedWorld> result);
  bool applyPendingWorld();
  bool hasPendingWorld() const;
  void refit(Extent extent);
  void reportShown();
  bool step(int64_t frameTimeNanos);
  float frameSeconds(int64_t frameTimeNanos);
  splat::Mat4 projection(Extent extent) const;
  StatsPublisher::Sample sample() const;
  void publishView(const SplatRenderer::Frame& frame);

  // Pick and project share an immutable snapshot of the last drawn camera and world.
  struct View {
    splat::Mat4 view = splat::Mat4::identity();
    splat::Mat4 cameraToWorld = splat::Mat4::identity();
    float projX = 0;  // the projection's x and y scales
    float projY = 0;
    float azimuth = 0;
    float elevation = 0;
    std::shared_ptr<const PickIndex> pickIndex;
  };
  View publishedView() const;

  EventSink events_;
  std::unique_ptr<SplatRenderer> renderer_;
  FileLoader loadFile_;
  std::atomic<int> maxShDegree_{kMaxShDegree};
  // Reservations share the publication, upload and event lock to prevent replacement between
  // validation and its consequence.
  mutable std::recursive_mutex loadMutex_;
  uint64_t currentLoad_ = 0;
  uint64_t uploadedLoad_ = 0;
  std::unique_ptr<splat::SplatCloud> pendingWorld_;
  OrbitCamera camera_;
  Highlight highlight_;
  Reveal reveal_;
  float revealSeconds_ = 0;
  // Framing bounds survive size changes until a pinch or pose replaces them.
  bool poseSet_ = false;
  std::optional<splat::Bounds> framedBounds_;
  Extent framedExtent_;
  StatsPublisher stats_;
  std::vector<int64_t> presentTimes_;
  // The uploaded world's pick index, published with the first frame drawn from it.
  std::shared_ptr<const PickIndex> pickIndex_;
  mutable std::mutex viewMutex_;
  std::optional<View> view_;

  // Ready requires both a draw of the new world and GPU completion.
  enum class Showing { nothing, awaitingDraw, awaitingGpu };
  Showing showing_ = Showing::nothing;
  bool gpuFailureReported_ = false;

  int shDegree_ = kMaxShDegree;
  uint32_t sourceCount_ = 0;
  int64_t lastFrameNanos_ = 0;
  bool redrawNeeded_ = true;
  uint32_t lastDrawnGeneration_ = 0;
};

}

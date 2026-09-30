#include "splatkit/engine/SplatEngine.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <utility>

#include "splatkit/Log.h"

namespace splatkit {
namespace {

// A frame longer than this (a stall, a resume) steps the camera as if it were this long.
constexpr float kMaxFrameSeconds = 0.1f;
// Room left around framed bounds, as a fraction of their radius.
constexpr float kFramingMargin = 1.05f;

using Clock = std::chrono::steady_clock;

double millisSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

splat::Vec3 centre(const splat::Bounds& b) {
  return {(b.min[0] + b.max[0]) * 0.5f, (b.min[1] + b.max[1]) * 0.5f,
          (b.min[2] + b.max[2]) * 0.5f};
}

// The distance at which the bounding sphere of `bounds` fits the narrower field of view.
float framingRadius(const splat::Bounds& bounds, Extent extent) {
  const splat::Vec3 half{(bounds.max[0] - bounds.min[0]) * 0.5f,
                         (bounds.max[1] - bounds.min[1]) * 0.5f,
                         (bounds.max[2] - bounds.min[2]) * 0.5f};
  const float sphere = splat::length(half);
  const float aspect = extent.width > 0 && extent.height > 0
                           ? static_cast<float>(extent.width) / extent.height
                           : 1.0f;
  const float halfY = SplatEngine::kFieldOfViewRadians * 0.5f;
  const float halfX = std::atan(std::tan(halfY) * std::max(aspect, 1e-3f));
  return sphere * kFramingMargin / std::sin(std::min(halfX, halfY));
}

bool finite(const splat::Bounds& b) {
  for (int i = 0; i < 3; ++i) {
    if (!std::isfinite(b.min[i]) || !std::isfinite(b.max[i]) || b.min[i] > b.max[i]) return false;
  }
  return true;
}

}  // namespace

SplatEngine::SplatEngine(std::unique_ptr<SplatRenderer> renderer) : renderer_(std::move(renderer)) {}

// The renderer goes first: it waits for the GPU, which may still read the world.
SplatEngine::~SplatEngine() {
  renderer_.reset();
}

void SplatEngine::setShDegree(int degree) {
  degree = std::clamp(degree, 0, kMaxShDegree);
  if (degree == shDegree_) return;
  shDegree_ = degree;
  redrawNeeded_ = true;
}

// Loading: decode on the calling thread, report, and leave the result for the frame.

void SplatEngine::loadWorld(splat::ByteView spz, splat::ByteView labels,
                            splat::CoordinateFrame sourceFrame) {
  report(loader_.loadWorld(spz, labels, sourceFrame));
}

void SplatEngine::loadWorldFile(const std::string& spzPath, const std::string& labelsPath,
                                splat::CoordinateFrame sourceFrame) {
  report(loader_.loadWorldFile(spzPath, labelsPath, sourceFrame));
}

void SplatEngine::report(const splat::Result<splat::SplatWorldLoader::WorldReport>& report) {
  if (!report) {
    const splat::Error& error = report.error();
    LOGE("world load failed: %s", error.message.c_str());
    emit(error.code == splat::ErrorCode::labelsMismatch ? Event::labelsMismatch
                                                        : Event::worldFailed,
         error.message);
    return;
  }
  const auto& r = report.value();
  LOGI("decoded %zu %s splats in %.0f ms, sh degree %d, bounds y [%.2f, %.2f], reordered in "
       "%.0f ms",
       r.splatCount, r.labelled ? "labelled" : "unlabelled", r.decodeMillis, r.shDegree,
       r.bounds.min[1], r.bounds.max[1], r.reorderMillis);
}

// Uploads what the loader left. True when a new world is drawn from now on.
bool SplatEngine::applyPendingWorld() {
  auto cloud = loader_.takeWorld();
  if (!cloud) return false;
  const auto start = Clock::now();
  if (!renderer_->uploadWorld(*cloud, kMaxShDegree)) {
    LOGE("world upload failed");
    emit(Event::worldFailed, "GPU upload failed");
    return false;
  }
  sourceCount_ = static_cast<uint32_t>(cloud->count());
  if (!poseSet_) {
    framedBounds_ = cloud->bounds;
    framedExtent_ = {};
  }
  const GpuWorldInfo gpu = renderer_->world().value_or(GpuWorldInfo{});
  LOGI("uploaded %u splats in %.0f ms, sh degree %d", gpu.count, millisSince(start), gpu.shDegree);
  emit(Event::worldReady, {}, sourceCount_);
  return true;
}

// Camera.

bool SplatEngine::setCameraPose(const OrbitPose& pose) {
  if (!camera_.setPose(pose)) return false;
  poseSet_ = true;
  framedBounds_.reset();
  redrawNeeded_ = true;
  return true;
}

bool SplatEngine::setCameraLimits(const OrbitLimits& limits) {
  if (!camera_.setLimits(limits)) return false;
  redrawNeeded_ = true;
  return true;
}

bool SplatEngine::orbit(float deltaAzimuth, float deltaElevation) {
  if (!camera_.orbit(deltaAzimuth, deltaElevation)) return false;
  redrawNeeded_ = true;
  return true;
}

bool SplatEngine::dolly(float factor) {
  if (!camera_.dolly(factor)) return false;
  redrawNeeded_ = true;
  return true;
}

bool SplatEngine::frame(const splat::Bounds& bounds, float seconds) {
  if (!finite(bounds)) return false;
  OrbitPose to = camera_.pose();
  to.target = centre(bounds);
  to.radius = framingRadius(bounds, renderer_->drawExtent());
  if (!camera_.animateTo(to, seconds)) return false;
  poseSet_ = true;
  framedBounds_.reset();
  redrawNeeded_ = true;
  return true;
}

// A world loaded before the view's final shape, or a phone turned, would otherwise keep a
// framing for the wrong aspect: too close after landscape to portrait.
void SplatEngine::reframeDefault(Extent extent) {
  if (!framedBounds_ || extent.width == 0 || extent.height == 0) return;
  if (extent.width == framedExtent_.width && extent.height == framedExtent_.height) return;
  framedExtent_ = extent;
  OrbitPose pose = camera_.pose();
  pose.target = centre(*framedBounds_);
  pose.radius = framingRadius(*framedBounds_, extent);
  camera_.setPose(pose);
  redrawNeeded_ = true;
}

void SplatEngine::setHighlight(const std::uint8_t* labels, std::size_t count) {
  highlight_.set(labels, count);
}

splat::Mat4 SplatEngine::projection(Extent extent) const {
  const float aspect = static_cast<float>(extent.width) / static_cast<float>(extent.height);
  return splat::Mat4::perspective(kFieldOfViewRadians, aspect, kNearPlane, kFarPlane);
}

// Stats.

void SplatEngine::publishStats() {
  stats_.publish(sample());
}

StatsPublisher::Sample SplatEngine::sample() const {
  StatsPublisher::Sample s;
  s.gpuMillis = renderer_->lastGpuMillis();
  s.sortMillis = renderer_->lastSortMillis();
  s.drawn = renderer_->lastDrawCount();
  s.sourceSplats = renderer_->world() ? sourceCount_ : 0;
  return s;
}

// The frame.

float SplatEngine::frameSeconds(int64_t frameTimeNanos) {
  const float dt =
      lastFrameNanos_ == 0 ? 0.0f : static_cast<float>(frameTimeNanos - lastFrameNanos_) * 1e-9f;
  lastFrameNanos_ = frameTimeNanos;
  return std::clamp(dt, 0.0f, kMaxFrameSeconds);
}

// Every vsync steps the camera, but the GPU only draws when something visible changed:
// a still scene costs no GPU time and almost no battery.
bool SplatEngine::render(int64_t frameTimeNanos) {
  if (!renderer_->ready()) return false;
  if (applyPendingWorld()) redrawNeeded_ = true;

  const Extent extent = renderer_->drawExtent();
  reframeDefault(extent);
  const float dt = frameSeconds(frameTimeNanos);
  if (camera_.update(dt)) redrawNeeded_ = true;
  if (highlight_.update(dt)) redrawNeeded_ = true;
  const uint32_t generation = renderer_->generation();
  if (generation != lastDrawnGeneration_) redrawNeeded_ = true;
  if (renderer_->reportsPresentTimes()) {
    const uint32_t dropped = renderer_->takePresentTimes(&presentTimes_);
    stats_.onPresented(presentTimes_, dropped);
  }
  const auto sampler = [this] { return sample(); };
  if (!redrawNeeded_) {
    stats_.onFrame(frameTimeNanos, false, sampler);
    return false;
  }

  SplatRenderer::Frame frame;
  frame.shDegree = shDegree_;
  frame.view = camera_.viewMatrix();
  frame.proj = projection(extent);
  frame.cameraPosition = camera_.position();
  frame.labelStyles = &highlight_.styles();
  if (!renderer_->draw(frame)) {
    stats_.onFrame(frameTimeNanos, false, sampler);
    return false;  // The redraw waits for the next frame; FPS must still age to zero.
  }
  redrawNeeded_ = false;
  lastDrawnGeneration_ = generation;
  stats_.onFrame(frameTimeNanos, true, sampler);
  return true;
}

}  // namespace splatkit

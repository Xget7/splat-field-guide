#include "splatkit/engine/SplatEngine.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <utility>

#include "splatkit/Log.h"

namespace splatkit {
namespace {

// A frame longer than this (a stall, a resume) steps the camera as if it were this long.
constexpr float kMaxFrameSeconds = 0.1f;
// A framed box fills at most 1 / this of the view's half width and half height.
constexpr float kFramingMargin = 1.05f;
// An aspect below this is treated as this, so a zero-width view still frames.
constexpr float kMinFramingAspect = 1e-3f;

using Clock = std::chrono::steady_clock;

double millisSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

splat::Vec3 centre(const splat::Bounds& b) {
  return {(b.min[0] + b.max[0]) * 0.5f, (b.min[1] + b.max[1]) * 0.5f,
          (b.min[2] + b.max[2]) * 0.5f};
}

// The closest distance that keeps every corner inside the screen margin and near plane.
float framingRadius(const splat::Bounds& bounds, Extent extent,
                    SplatEngine::ViewDirection from) {
  const splat::Vec3 half{(bounds.max[0] - bounds.min[0]) * 0.5f,
                         (bounds.max[1] - bounds.min[1]) * 0.5f,
                         (bounds.max[2] - bounds.min[2]) * 0.5f};
  if (splat::length(half) == 0) return 0;
  const float aspect = extent.width > 0 && extent.height > 0
                           ? static_cast<float>(extent.width) / extent.height
                           : 1.0f;
  const float tanY = std::tan(SplatEngine::kFieldOfViewRadians * 0.5f);
  const float tanX = tanY * std::max(aspect, kMinFramingAspect);
  const float horizontal = std::cos(from.elevation);
  const splat::Vec3 forward{-horizontal * std::sin(from.azimuth), -std::sin(from.elevation),
                            -horizontal * std::cos(from.azimuth)};
  // Match OrbitCamera's view basis so the offsets are the ones the projection sees.
  const splat::Vec3 right = splat::normalize(splat::cross(forward, {0, 1, 0}));
  const splat::Vec3 up = splat::cross(right, forward);
  float radius = 0;
  for (const float x : {-half.x, half.x}) {
    for (const float y : {-half.y, half.y}) {
      for (const float z : {-half.z, half.z}) {
        const splat::Vec3 p{x, y, z};
        const float depth = splat::dot(p, forward);
        radius = std::max({radius, kFramingMargin * std::abs(splat::dot(p, right)) / tanX - depth,
                           kFramingMargin * std::abs(splat::dot(p, up)) / tanY - depth,
                           SplatEngine::kNearPlane - depth});
      }
    }
  }
  return radius;
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

bool SplatEngine::loadWorld(splat::ByteView spz, splat::ByteView labels,
                            splat::CoordinateFrame sourceFrame) {
  return report(loader_.loadWorld(spz, labels, sourceFrame));
}

bool SplatEngine::loadWorldFile(const std::string& spzPath, const std::string& labelsPath,
                                splat::CoordinateFrame sourceFrame) {
  return report(loader_.loadWorldFile(spzPath, labelsPath, sourceFrame));
}

bool SplatEngine::report(const splat::Result<splat::SplatWorldLoader::WorldReport>& report) {
  if (!report) {
    const splat::Error& error = report.error();
    LOGE("world load failed: %s", error.message.c_str());
    emit(error.code == splat::ErrorCode::labelsMismatch ? Event::labelsMismatch
                                                        : Event::worldFailed,
         error.message);
    return false;
  }
  const auto& r = report.value();
  LOGI("decoded %zu %s splats in %.0f ms (%zu removed as haze, %zu as floaters), sh degree "
       "%d, bounds y [%.2f, %.2f], reordered in %.0f ms",
       r.splatCount, r.labelled ? "labelled" : "unlabelled", r.decodeMillis, r.hazeRemoved,
       r.sparseRemoved, r.shDegree, r.bounds.min[1], r.bounds.max[1], r.reorderMillis);
  return true;
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
  pickIndex_ = PickIndex::take(*cloud);
  if (!poseSet_) {
    framedBounds_ = cloud->bounds;
    framedExtent_ = {};
  }
  showing_ = Showing::awaitingDraw;
  reveal_.start(cloud->bounds, revealSeconds_);
  const GpuWorldInfo gpu = renderer_->world().value_or(GpuWorldInfo{});
  LOGI("uploaded %u splats in %.0f ms, sh degree %d", gpu.count, millisSince(start), gpu.shDegree);
  return true;
}

// Ready once the world is on screen: a host that shows its view then shows the world.
void SplatEngine::reportShown() {
  if (showing_ != Showing::awaitingGpu || !renderer_->hasCompletedWorldFrame()) return;
  showing_ = Showing::nothing;
  emit(Event::worldReady, {}, sourceCount_);
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
  framedBounds_.reset();
  redrawNeeded_ = true;
  return true;
}

bool SplatEngine::frame(const splat::Bounds& bounds, float seconds,
                        std::optional<ViewDirection> from) {
  if (!finite(bounds)) return false;
  const Extent extent = renderer_->drawExtent();
  OrbitPose to = camera_.pose();
  if (from) {
    to.azimuth = from->azimuth;
    to.elevation = from->elevation;
    // Fit from the direction the camera's limits will allow.
    OrbitCamera directed = camera_;
    if (!directed.setPose(to)) return false;
    to = directed.pose();
  }
  to.target = centre(bounds);
  to.radius = framingRadius(bounds, extent, {to.azimuth, to.elevation});
  // Nothing is on screen before the view has a size, so there is nothing to ease from.
  const bool sized = extent.width > 0 && extent.height > 0;
  if (!camera_.animateTo(to, sized ? seconds : 0)) return false;
  poseSet_ = true;
  framedBounds_ = bounds;
  framedExtent_ = extent;
  redrawNeeded_ = true;
  return true;
}

// A framing made before the view's final shape, or kept through a turn of the phone, would
// otherwise fit the wrong aspect: too close after landscape to portrait. A running animation
// finishes first.
void SplatEngine::refit(Extent extent) {
  if (!framedBounds_ || extent.width == 0 || extent.height == 0 || camera_.animating()) return;
  if (extent.width == framedExtent_.width && extent.height == framedExtent_.height) return;
  framedExtent_ = extent;
  OrbitPose pose = camera_.pose();
  pose.target = centre(*framedBounds_);
  pose.radius = framingRadius(*framedBounds_, extent, {pose.azimuth, pose.elevation});
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

// Pick and project, from any thread, against the last drawn frame.

void SplatEngine::publishView(const SplatRenderer::Frame& frame) {
  View view;
  view.view = frame.view;
  view.cameraToWorld = frame.view.rigidInverse();
  view.projX = frame.proj.at(0, 0);
  view.projY = frame.proj.at(1, 1);
  view.pickIndex = pickIndex_;
  std::lock_guard<std::mutex> lock(viewMutex_);
  view_ = std::move(view);
}

SplatEngine::View SplatEngine::publishedView() const {
  std::lock_guard<std::mutex> lock(viewMutex_);
  return view_.value_or(View{});
}

std::uint8_t SplatEngine::pick(float x, float y) const {
  const View view = publishedView();
  if (!view.pickIndex || !std::isfinite(x) || !std::isfinite(y)) return 0;
  // Back through the projection: the point's direction in camera space, looking down -Z.
  const splat::Vec3 inCamera{(2 * x - 1) / view.projX, (1 - 2 * y) / view.projY, -1};
  Ray ray;
  ray.origin = view.cameraToWorld.transformPoint({0, 0, 0});
  ray.direction = splat::normalize(view.cameraToWorld.transformDirection(inCamera));
  return view.pickIndex->pick(ray);
}

std::size_t SplatEngine::project(const float* points, std::size_t count, float* out) const {
  const View view = publishedView();
  std::size_t inFront = 0;
  for (std::size_t i = 0; i < count; ++i) {
    const splat::Vec3 p =
        view.view.transformPoint({points[i * 3], points[i * 3 + 1], points[i * 3 + 2]});
    const float depth = -p.z;
    float* uv = out + i * 2;
    if (view.projX == 0 || depth < kNearPlane) {
      uv[0] = uv[1] = std::numeric_limits<float>::quiet_NaN();
      continue;
    }
    uv[0] = (view.projX * p.x / depth + 1) * 0.5f;
    uv[1] = (1 - view.projY * p.y / depth) * 0.5f;
    ++inFront;
  }
  return inFront;
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

bool SplatEngine::needsFrame() const {
  if (renderer_->failed()) return !gpuFailureReported_;
  if (!renderer_->ready()) return false;
  return redrawNeeded_ || showing_ != Showing::nothing || camera_.animating() ||
         highlight_.fading() || reveal_.active() || loader_.hasWorld() ||
         renderer_->generation() != lastDrawnGeneration_;
}

bool SplatEngine::render(int64_t frameTimeNanos) {
  const bool drawn = step(frameTimeNanos);
  if (!needsFrame()) lastFrameNanos_ = 0;
  return drawn;
}

// Every vsync steps the camera, but the GPU only draws when something visible changed:
// a still scene costs no GPU time and almost no battery.
bool SplatEngine::step(int64_t frameTimeNanos) {
  if (renderer_->failed()) {
    if (!gpuFailureReported_) {
      gpuFailureReported_ = true;
      LOGE("the GPU failed; this view draws nothing more");
      emit(Event::gpuFailed, "The GPU reported an error");
    }
    return false;
  }
  if (!renderer_->ready()) return false;
  if (applyPendingWorld()) redrawNeeded_ = true;

  const Extent extent = renderer_->drawExtent();
  const float dt = frameSeconds(frameTimeNanos);
  if (camera_.update(dt)) redrawNeeded_ = true;
  // After the step: the frame that ends an animation is the first one free to refit.
  refit(extent);
  if (highlight_.update(dt)) redrawNeeded_ = true;
  if (reveal_.update(dt)) redrawNeeded_ = true;
  const uint32_t generation = renderer_->generation();
  if (generation != lastDrawnGeneration_) redrawNeeded_ = true;
  if (renderer_->reportsPresentTimes()) {
    const uint32_t dropped = renderer_->takePresentTimes(&presentTimes_);
    stats_.onPresented(presentTimes_, dropped);
  }
  const auto sampler = [this] { return sample(); };
  if (!redrawNeeded_) {
    stats_.onFrame(frameTimeNanos, false, sampler);
    reportShown();
    return false;
  }

  SplatRenderer::Frame frame;
  frame.shDegree = shDegree_;
  frame.view = camera_.viewMatrix();
  frame.proj = projection(extent);
  frame.cameraPosition = camera_.position();
  frame.labelStyles = &highlight_.styles();
  frame.revealLevel = reveal_.level();
  frame.revealBand = reveal_.band();
  if (!renderer_->draw(frame)) {
    stats_.onFrame(frameTimeNanos, false, sampler);
    return false;  // The redraw waits for the next frame; FPS must still age to zero.
  }
  redrawNeeded_ = false;
  lastDrawnGeneration_ = generation;
  if (showing_ == Showing::awaitingDraw) showing_ = Showing::awaitingGpu;
  publishView(frame);
  stats_.onFrame(frameTimeNanos, true, sampler);
  reportShown();
  return true;
}

}  // namespace splatkit

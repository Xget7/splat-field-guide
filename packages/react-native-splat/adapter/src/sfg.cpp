#include "sfg/sfg.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <mutex>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "splatkit/engine/SplatEngine.h"
#include "sfg/sfg_platform.h"

struct sfg_engine {
  // Retain the host interval so equivalent angles can be normalized before the
  // engine's linear clamp, including intervals crossing pi.
  std::optional<std::pair<float, float>> azimuthLimits;
  float constrainedAzimuth(float angle) const {
    constexpr float kFullTurn = 6.28318530717959f;
    if (!azimuthLimits) return angle;
    const auto [low, high] = *azimuthLimits;
    const float middle = (low + high) / 2;
    return std::clamp(middle + std::remainder(angle - middle, kFullTurn), low, high);
  }
  // The host's highlight is a standing request sent with its first props, while the engine
  // scopes a highlight to the world it was made on and refuses one before a world exists.
  // Render thread only.
  std::vector<uint16_t> highlight;
  bool worldLoaded = false;
  void applyHighlight() { engine->highlightParts(highlight.data(), highlight.size()); }
  std::mutex callbackMutex;
  sfg_event_callback callback = nullptr;
  void* context = nullptr;
  std::unique_ptr<splatkit::SplatEngine> engine;
  void emit(sfg_event event, const std::string& message, uint32_t count) {
    sfg_event_callback selected;
    void* selectedContext;
    {
      const std::lock_guard<std::mutex> lock(callbackMutex);
      selected = callback;
      selectedContext = context;
    }
    if (selected) selected(selectedContext, event, message.c_str(), count);
  }
};

namespace splatkit {
namespace {

// Blending a wide view's splats is bound by the pixels they cover; three quarters of the
// resolution covers about 44% fewer and the upscaler keeps edges sharp on a Retina screen.
constexpr float kRenderScale = 0.75f;

std::optional<sfg_event> toC(SplatEngine::Event event) {
  switch (event) {
    case SplatEngine::Event::worldFrameReady:
      return SFG_EVENT_WORLD_READY;
    case SplatEngine::Event::worldFailed:
      return SFG_EVENT_LOAD_FAILED;
    case SplatEngine::Event::labelsMismatch:
      return SFG_EVENT_LABELS_MISMATCH;
    case SplatEngine::Event::gpuFailed:
      return SFG_EVENT_GPU_FAILED;
    case SplatEngine::Event::worldReady:
    case SplatEngine::Event::colliderReady:
    case SplatEngine::Event::colliderFailed:
      return std::nullopt;
  }
  return std::nullopt;
}

std::array<float, 3> toArray(sfg_vec3 v) {
  return {v.x, v.y, v.z};
}

}  // namespace

sfg_engine* makeSfgEngine(std::unique_ptr<SplatRenderer> renderer) {
  renderer->setRenderScale(kRenderScale);
  auto result = std::make_unique<sfg_engine>();
  result->engine = std::make_unique<SplatEngine>(std::move(renderer));
  sfg_set_camera_limits(result.get(), nullptr);
  result->engine->setPartPickingEnabled(true);
  result->engine->setDrawnFrameQueriesEnabled(true);
  // Install once: the upstream sink itself is not safe to replace during a worker load.
  result->engine->setEventSink([host = result.get()](SplatEngine::Event event,
                                  const std::string& message, uint32_t count) {
    // Enter the default orbit after upload without making its anchor explicit, so
    // subsequent worlds and surface size changes still get automatic framing.
    if (event == SplatEngine::Event::worldReady) {
      host->engine->orbit(0, 0);
      host->worldLoaded = true;
      if (!host->highlight.empty()) host->applyHighlight();
    }
    if (const auto mapped = toC(event)) host->emit(*mapped, message, count);
  });
  return result.release();
}

SplatEngine& engineOf(sfg_engine* engine) {
  return *engine->engine;
}

const SplatEngine& engineOf(const sfg_engine* engine) {
  return *engine->engine;
}

}  // namespace splatkit

using splatkit::engineOf;

extern "C" {

void sfg_destroy(sfg_engine* engine) {
  delete engine;
}

void sfg_set_event_callback(sfg_engine* engine, sfg_event_callback callback, void* context) {
  const std::lock_guard<std::mutex> lock(engine->callbackMutex);
  engine->callback = callback;
  engine->context = context;
}

uint64_t sfg_begin_load(sfg_engine* engine) {
  return engineOf(engine).beginLoad();
}

bool sfg_load_request(sfg_engine* engine, uint64_t request, const char* world_path,
                      const char* labels_path, const sfg_source_identity* identity) {
  splatkit::SplatEngine::LoadOptions options;
  if (identity) {
    const auto digest = [](const char* hex) -> std::optional<std::array<uint8_t, 32>> {
      if (!hex || std::strlen(hex) != 64) return std::nullopt;
      const auto nibble = [](char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
      };
      std::array<uint8_t, 32> bytes{};
      for (size_t i = 0; i < bytes.size(); ++i) {
        const int hi = nibble(hex[2 * i]), lo = nibble(hex[2 * i + 1]);
        if (hi < 0 || lo < 0) return std::nullopt;
        bytes[i] = static_cast<uint8_t>((hi << 4) | lo);
      }
      return bytes;
    };
    options.expectedSha256 = digest(identity->splat_sha256);
    options.expectedLabelsSha256 = digest(identity->labels_sha256);
    options.expectedSplatCount = identity->expected_splat_count;
    if (!options.expectedSha256 || !options.expectedLabelsSha256) {
      // Route rejection through the reservation-aware public loader so a concurrent
      // replacement suppresses even malformed-identity failures atomically.
      return engineOf(engine).loadWorld(request, nullptr, 0);
    }
  }
  return engineOf(engine).loadWorldFile(request, world_path,
                                       labels_path ? labels_path : "", options);
}

bool sfg_draw(sfg_engine* engine, int64_t frame_time_nanos) {
  return engineOf(engine).render(frame_time_nanos);
}

bool sfg_needs_frame(const sfg_engine* engine) {
  return engineOf(engine).needsFrame();
}

bool sfg_orbit(sfg_engine* engine, float d_azimuth, float d_elevation) {
  const float current = engineOf(engine).cameraState().azimuth;
  return engineOf(engine).orbit(engine->constrainedAzimuth(current + d_azimuth) - current,
                                d_elevation);
}

bool sfg_dolly(sfg_engine* engine, float factor) {
  if (!std::isfinite(factor) || factor <= 0) return false;
  const float radius = engineOf(engine).cameraState().radius;
  return engineOf(engine).dolly(radius / factor - radius);
}

bool sfg_set_camera_limits(sfg_engine* engine, const sfg_camera_limits* limits) {
  // Default-constructed limits are the engine's own range: clear of the poles and of the splats.
  const splatkit::WalkCamera::OrbitLimits engineRange;
  splatkit::WalkCamera::OrbitLimits l;
  constexpr float kDefaultMaxRadius = 1000;
  if (limits == nullptr) {
    l.maxRadius = kDefaultMaxRadius;
    if (!engineOf(engine).setOrbitLimits(l)) return false;
    engine->azimuthLimits.reset();
    return true;
  }
  constexpr float kFullTurn = 6.28318530717959f;
  constexpr float kTurnSlack = 1e-4f;
  const float values[] = {limits->min_azimuth, limits->max_azimuth,
      limits->min_elevation, limits->max_elevation, limits->min_radius, limits->max_radius};
  for (float value : values) if (!std::isfinite(value)) return false;
  if (limits->min_azimuth < -kFullTurn || limits->max_azimuth > kFullTurn ||
      limits->max_azimuth - limits->min_azimuth > kFullTurn + kTurnSlack) return false;
  constexpr float kPole = 1.57079632679490f;
  if (std::abs(limits->min_elevation) >= kPole || std::abs(limits->max_elevation) >= kPole ||
      limits->min_radius <= 0) return false;
  l.minAzimuth = limits->min_azimuth;
  l.maxAzimuth = limits->max_azimuth;
  // Authored limits wider than the engine's range narrow to it, so the camera stays inside both;
  // limits wholly outside it leave nothing and the engine refuses them.
  l.minElevation = std::max(limits->min_elevation, engineRange.minElevation);
  l.maxElevation = std::min(limits->max_elevation, engineRange.maxElevation);
  l.minRadius = std::max(limits->min_radius, engineRange.minRadius);
  l.maxRadius = limits->max_radius;
  if (l.maxAzimuth - l.minAzimuth >= kFullTurn - kTurnSlack) {
    l.minAzimuth = -std::numeric_limits<float>::infinity();
    l.maxAzimuth = std::numeric_limits<float>::infinity();
  }
  const auto current = engineOf(engine).cameraState();
  if (!engineOf(engine).setOrbitLimits(l)) return false;
  if (std::isfinite(l.minAzimuth)) engine->azimuthLimits = {l.minAzimuth, l.maxAzimuth};
  else engine->azimuthLimits.reset();
  if (current.hasAnchor) {
    const float clamped = engineOf(engine).cameraState().azimuth;
    engineOf(engine).orbit(engine->constrainedAzimuth(current.azimuth) - clamped, 0);
  }
  return true;
}

bool sfg_frame(sfg_engine* engine, const sfg_bounds* bounds, float seconds,
               const sfg_view_direction* from) {
  splat::Bounds b;
  b.min = splatkit::toArray(bounds->min);
  b.max = splatkit::toArray(bounds->max);
  std::optional<splatkit::SplatEngine::ViewDirection> direction;
  if (from != nullptr)
    direction = splatkit::SplatEngine::ViewDirection{engine->constrainedAzimuth(from->azimuth), from->elevation};
  return engineOf(engine).frameBounds(b, seconds, direction);
}

void sfg_set_highlight(sfg_engine* engine, const uint16_t* labels, size_t count) {
  if (labels == nullptr) count = 0;
  engine->highlight.assign(labels, labels + count);
  if (engine->worldLoaded) engine->applyHighlight();
}

void sfg_set_reveal(sfg_engine* engine, float seconds) {
  constexpr uint32_t kRevealTint = 0x0A6CFF;
  constexpr float kTintAmount = 0.85f;
  constexpr float kBrightnessBoost = 0.9f;
  constexpr float kBandShare = 0.08f;
  splatkit::RevealSettings settings;
  settings.seconds = seconds;
  settings.tint[0] = ((kRevealTint >> 16) & 255) / 255.0f;
  settings.tint[1] = ((kRevealTint >> 8) & 255) / 255.0f;
  settings.tint[2] = (kRevealTint & 255) / 255.0f;
  settings.tintAmount = kTintAmount;
  settings.brightnessBoost = kBrightnessBoost;
  settings.bandShare = kBandShare;
  engineOf(engine).setReveal(settings);
}

uint16_t sfg_pick(const sfg_engine* engine, float x, float y) {
  return engineOf(engine).pick(x, y);
}

size_t sfg_project(const sfg_engine* engine, const float* points, size_t count, float* out_xy) {
  return engineOf(engine).project(points, count, out_xy);
}

bool sfg_drawn_direction(const sfg_engine* engine, sfg_view_direction* out) {
  splatkit::SplatEngine::ViewDirection direction;
  if (!engineOf(engine).drawnDirection(direction)) return false;
  *out = {direction.azimuth, direction.elevation};
  return true;
}
}

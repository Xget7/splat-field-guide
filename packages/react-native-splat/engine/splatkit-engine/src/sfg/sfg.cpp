#include "splatkit/sfg.h"

#include <array>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "splatkit/engine/SplatEngine.h"
#include "splatkit/sfg_platform.h"

struct sfg_engine {
  std::unique_ptr<splatkit::SplatEngine> engine;
};

namespace splatkit {
namespace {

// Packs keep their cloud in SPZ's own frame, +X right, +Y up, +Z back.
constexpr splat::CoordinateFrame kPackFrame = splat::CoordinateFrame::rub;

sfg_event toC(SplatEngine::Event event) {
  switch (event) {
    case SplatEngine::Event::worldReady:
      return SFG_EVENT_WORLD_READY;
    case SplatEngine::Event::worldFailed:
      return SFG_EVENT_LOAD_FAILED;
    case SplatEngine::Event::labelsMismatch:
      return SFG_EVENT_LABELS_MISMATCH;
    case SplatEngine::Event::gpuFailed:
      return SFG_EVENT_GPU_FAILED;
  }
  return SFG_EVENT_LOAD_FAILED;
}

splat::Vec3 toVec3(sfg_vec3 v) {
  return {v.x, v.y, v.z};
}

std::array<float, 3> toArray(sfg_vec3 v) {
  return {v.x, v.y, v.z};
}

sfg_vec3 toC(splat::Vec3 v) {
  return {v.x, v.y, v.z};
}

}  // namespace

sfg_engine* makeSfgEngine(std::unique_ptr<SplatRenderer> renderer, SplatEngine::FileLoader loadFile) {
  return new sfg_engine{std::make_unique<SplatEngine>(std::move(renderer), std::move(loadFile))};
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
  if (callback == nullptr) {
    engineOf(engine).setEventSink({});
    return;
  }
  engineOf(engine).setEventSink([callback, context](splatkit::SplatEngine::Event event,
                                                    const std::string& message, uint32_t count) {
    callback(context, splatkit::toC(event), message.c_str(), count);
  });
}

bool sfg_load(sfg_engine* engine, const char* spz_path, const char* labels_path) {
  return engineOf(engine).loadWorldFile(spz_path, labels_path != nullptr ? labels_path : "",
                                        splatkit::kPackFrame);
}

uint64_t sfg_begin_load(sfg_engine* engine) { return engineOf(engine).beginLoad(); }

bool sfg_load_request(sfg_engine* engine, uint64_t request, const char* spz_path, const char* labels_path) {
  return engineOf(engine).loadWorldFile(request, spz_path, labels_path != nullptr ? labels_path : "",
                                        splatkit::kPackFrame);
}

bool sfg_draw(sfg_engine* engine, int64_t frame_time_nanos) {
  return engineOf(engine).render(frame_time_nanos);
}

bool sfg_needs_frame(const sfg_engine* engine) {
  return engineOf(engine).needsFrame();
}

bool sfg_orbit(sfg_engine* engine, float d_azimuth, float d_elevation) {
  return engineOf(engine).orbit(d_azimuth, d_elevation);
}

bool sfg_dolly(sfg_engine* engine, float factor) {
  return engineOf(engine).dolly(factor);
}

bool sfg_set_camera_pose(sfg_engine* engine, const sfg_orbit_pose* pose) {
  splatkit::OrbitPose p;
  p.target = splatkit::toVec3(pose->target);
  p.radius = pose->radius;
  p.azimuth = pose->azimuth;
  p.elevation = pose->elevation;
  return engineOf(engine).setCameraPose(p);
}

sfg_orbit_pose sfg_camera_pose(const sfg_engine* engine) {
  const splatkit::OrbitPose& p = engineOf(engine).cameraPose();
  return {splatkit::toC(p.target), p.radius, p.azimuth, p.elevation};
}

bool sfg_set_camera_limits(sfg_engine* engine, const sfg_camera_limits* limits) {
  splatkit::OrbitLimits l;
  if (limits == nullptr) return engineOf(engine).setCameraLimits(l);
  l.minAzimuth = limits->min_azimuth;
  l.maxAzimuth = limits->max_azimuth;
  l.minElevation = limits->min_elevation;
  l.maxElevation = limits->max_elevation;
  l.minRadius = limits->min_radius;
  l.maxRadius = limits->max_radius;
  return engineOf(engine).setCameraLimits(l);
}

bool sfg_frame(sfg_engine* engine, const sfg_bounds* bounds, float seconds,
               const sfg_view_direction* from) {
  splat::Bounds b;
  b.min = splatkit::toArray(bounds->min);
  b.max = splatkit::toArray(bounds->max);
  std::optional<splatkit::SplatEngine::ViewDirection> direction;
  if (from != nullptr)
    direction = splatkit::SplatEngine::ViewDirection{from->azimuth, from->elevation};
  return engineOf(engine).frame(b, seconds, direction);
}

void sfg_set_highlight(sfg_engine* engine, const uint8_t* labels, size_t count) {
  engineOf(engine).setHighlight(labels, labels != nullptr ? count : 0);
}

void sfg_set_reveal(sfg_engine* engine, float seconds) {
  engineOf(engine).setRevealSeconds(seconds);
}

uint8_t sfg_pick(const sfg_engine* engine, float x, float y) {
  return engineOf(engine).pick(x, y);
}

size_t sfg_project(const sfg_engine* engine, const float* points, size_t count, float* out_xy) {
  return engineOf(engine).project(points, count, out_xy);
}

bool sfg_drawn_direction(const sfg_engine* engine, sfg_view_direction* out) {
  return engineOf(engine).drawnDirection(out->azimuth, out->elevation);
}

}  // extern "C"

#pragma once

// The engine as C, for the platform views: one engine per view, made by the platform's own
// create function (sfg_metal.h on iOS). Angles are radians and distances metres; a point on
// the view is (x, y) in [0, 1] from its top left.
//
// Threads: an engine belongs to its view's render thread, which makes every call not marked
// otherwise. sfg_load runs on any thread, and sfg_pick and sfg_project on any thread against
// the frame last drawn. Destroy it once no other thread is in a call.

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Nullability is for Swift, which imports every pointer not marked nullable as non-optional.
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wnullability-extension"
#pragma clang assume_nonnull begin
#define SFG_NULLABLE _Nullable
#else
#define SFG_NULLABLE
#endif

typedef struct sfg_engine sfg_engine;

typedef struct {
  float x;
  float y;
  float z;
} sfg_vec3;

typedef struct {
  sfg_vec3 min;
  sfg_vec3 max;
} sfg_bounds;

// The camera `radius` from `target`, turned `azimuth` about +Y from +Z and raised
// `elevation` above the horizontal, looking at the target.
typedef struct {
  sfg_vec3 target;
  float radius;
  float azimuth;
  float elevation;
} sfg_orbit_pose;

// Where a framing looks from.
typedef struct {
  float azimuth;
  float elevation;
} sfg_view_direction;

// The angles and distances the camera may take. An azimuth range of a full turn turns freely;
// a narrower one, which may cross pi, keeps the camera on the side that was captured.
typedef struct {
  float min_azimuth;
  float max_azimuth;
  float min_elevation;
  float max_elevation;
  float min_radius;
  float max_radius;
} sfg_camera_limits;

typedef enum {
  // The loaded world is on screen; the count is its splats.
  SFG_EVENT_WORLD_READY = 0,
  SFG_EVENT_LOAD_FAILED = 1,
  // The part labels are for another cloud.
  SFG_EVENT_LABELS_MISMATCH = 2,
  // Final: the view draws nothing more.
  SFG_EVENT_GPU_FAILED = 3,
} sfg_event;

// `message` says what failed, empty when nothing did, and lives only for the call.
typedef void (*sfg_event_callback)(void* SFG_NULLABLE context, sfg_event event, const char* message,
                                   uint32_t splat_count);

void sfg_destroy(sfg_engine* engine);

// Where events go: ready from the render thread, failures from the thread that found them.
// Set it before the first load.
void sfg_set_event_callback(sfg_engine* engine, sfg_event_callback SFG_NULLABLE callback,
                            void* SFG_NULLABLE context);

// Any thread, blocking while it decodes: a pack's cloud, SPZ in its own +Y up frame, and its
// part labels, or NULL for none. The next frame after it uploads the world and draws it from
// then on. False when it failed, which is also an event; the current world stays.
bool sfg_load(sfg_engine* engine, const char* spz_path, const char* SFG_NULLABLE labels_path);

// One vsync: steps the camera and the highlight and draws if anything visible changed. True
// when a frame was drawn.
bool sfg_draw(sfg_engine* engine, int64_t frame_time_nanos);
// Whether the next vsync has anything to do. While it is false the view may stop its display
// link; any call here, a finished load or a new surface is a reason to start it again.
bool sfg_needs_frame(const sfg_engine* engine);

// Turns the camera, stopping at its limits and stopping any framing.
bool sfg_orbit(sfg_engine* engine, float d_azimuth, float d_elevation);
// A pinch's scale: above one moves closer.
bool sfg_dolly(sfg_engine* engine, float factor);
bool sfg_set_camera_pose(sfg_engine* engine, const sfg_orbit_pose* pose);
sfg_orbit_pose sfg_camera_pose(const sfg_engine* engine);
// False, changing nothing, for limits that are not finite, inverted, wider than a full turn
// or past a pole.
bool sfg_set_camera_limits(sfg_engine* engine, const sfg_camera_limits* limits);
// Eases the camera over `seconds` until `bounds` fills the view, looking from `from` or, when
// NULL, from where it looks now. The framing holds through a change of the view's shape until
// a pinch or a pose replaces it.
bool sfg_frame(sfg_engine* engine, const sfg_bounds* bounds, float seconds,
               const sfg_view_direction* SFG_NULLABLE from);

// Emphasises the parts with these labels and dims the rest, fading from the last highlight.
// None shows every splat as captured.
void sfg_set_highlight(sfg_engine* engine, const uint8_t* SFG_NULLABLE labels, size_t count);

// Any thread: the part label under (x, y) in the frame last drawn, 0 for none. Milliseconds of
// work, so not for the render thread.
uint8_t sfg_pick(const sfg_engine* engine, float x, float y);
// Any thread: where each of `count` world points (x, y, z) shows in the frame last drawn,
// written to `out_xy` as (x, y), NaN for one behind the camera. Returns how many are in front.
size_t sfg_project(const sfg_engine* engine, const float* points, size_t count, float* out_xy);

#if defined(__clang__)
#pragma clang assume_nonnull end
#pragma clang diagnostic pop
#endif

#ifdef __cplusplus
}
#endif

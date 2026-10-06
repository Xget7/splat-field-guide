#pragma once

// One engine per view uses radians, metres and view xy in [0, 1] from the top left.
// Calls use the render thread unless marked otherwise; destruction waits until no other thread is
// in a call.

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

// Orbit uses radius from target, azimuth about +Y from +Z and elevation above horizontal.
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

// Full-turn azimuth limits permit free orbit; narrower ranges may cross pi.
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

// Install events before loading; ready reports on the render thread and failures on the thread that
// detects them.
void sfg_set_event_callback(sfg_engine* engine, sfg_event_callback SFG_NULLABLE callback,
                            void* SFG_NULLABLE context);

// Any thread may decode SPZ RUB files with optional labels; failure reports an event and preserves
// the current world until a successful replacement draws.
bool sfg_load(sfg_engine* engine, const char* spz_path, const char* SFG_NULLABLE labels_path);

// Any thread may reserve a replacement that supersedes older decoding, pending uploads and
// completion events.
uint64_t sfg_begin_load(sfg_engine* engine);
// Identity from the pack manifest, checked before a decoded cloud can be accepted.
typedef struct {
  const char* splat_sha256;
  const char* labels_sha256;
  uint32_t expected_splat_count;
} sfg_source_identity;
// Any thread may decode for a reservation while retaining the engine; superseded requests return
// false without failure events.
bool sfg_load_request(sfg_engine* engine, uint64_t request, const char* spz_path,
                      const char* SFG_NULLABLE labels_path,
                      const sfg_source_identity* SFG_NULLABLE identity);

// One vsync advances animations and draws changed content, returning whether a frame was drawn.
bool sfg_draw(sfg_engine* engine, int64_t frame_time_nanos);
// Hosts may stop their display link while false and wake it on input, load completion or a new
// surface.
bool sfg_needs_frame(const sfg_engine* engine);

// Turns the camera, stopping at its limits and stopping any framing.
bool sfg_orbit(sfg_engine* engine, float d_azimuth, float d_elevation);
// A pinch's scale: above one moves closer.
bool sfg_dolly(sfg_engine* engine, float factor);
bool sfg_set_camera_pose(sfg_engine* engine, const sfg_orbit_pose* pose);
sfg_orbit_pose sfg_camera_pose(const sfg_engine* engine);
// Reject non-finite, inverted, over-full-turn or pole-crossing limits without changes; NULL
// restores free orbit.
bool sfg_set_camera_limits(sfg_engine* engine, const sfg_camera_limits* SFG_NULLABLE limits);
// Framing uses from or the current direction when NULL, refits on size changes and holds until a
// pinch or pose replaces it.
bool sfg_frame(sfg_engine* engine, const sfg_bounds* bounds, float seconds,
               const sfg_view_direction* SFG_NULLABLE from);

// Highlights fade between label sets and dim the rest; no labels restore captured styles.
void sfg_set_highlight(sfg_engine* engine, const uint8_t* SFG_NULLABLE labels, size_t count);
// Reveal duration uses seconds for a bottom-up sweep; zero shows the world immediately.
void sfg_set_reveal(sfg_engine* engine, float seconds);

// Any worker thread may pick normalized xy in the last drawn frame, returning zero for no part; the
// work may take milliseconds.
uint8_t sfg_pick(const sfg_engine* engine, float x, float y);
// Any thread may project count world xyz points into last-frame xy, with NaN behind the camera and
// the in-front count returned.
size_t sfg_project(const sfg_engine* engine, const float* points, size_t count, float* out_xy);
// Any thread may read the last drawn direction; before the first frame, false leaves out unchanged.
bool sfg_drawn_direction(const sfg_engine* engine, sfg_view_direction* out);

#if defined(__clang__)
#pragma clang assume_nonnull end
#pragma clang diagnostic pop
#endif

#ifdef __cplusplus
}
#endif

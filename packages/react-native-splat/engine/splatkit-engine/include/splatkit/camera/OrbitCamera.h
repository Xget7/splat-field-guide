#pragma once

#include <optional>

#include "splat/math/Mat4.h"
#include "splat/math/Vec3.h"

namespace splatkit {

// Orbit poses use metres, azimuth about +Y from +Z and elevation above horizontal in radians, with
// +Y up on screen.
struct OrbitPose {
  splat::Vec3 target;
  float radius = 1;
  float azimuth = 0;
  float elevation = 0;
};

// Limits use radians and metres; full-turn azimuth ranges permit free orbit and narrower ranges may
// cross pi.
struct OrbitLimits {
  static constexpr float kFullTurn = 6.28318530717959f;

  float minAzimuth = -kFullTurn / 2;
  float maxAzimuth = kFullTurn / 2;
  float minElevation = -1.4835f;  // -85 degrees: short of the pole, where up is undefined
  float maxElevation = 1.4835f;
  float minRadius = 0.05f;
  float maxRadius = 1000.0f;
};

// Poses stay within limits; callers must serialize access.
class OrbitCamera {
 public:
  // Reject non-finite poses without changes; accepted poses clamp to limits and stop animation.
  bool setPose(const OrbitPose& pose);
  const OrbitPose& pose() const { return pose_; }

  // Reject non-finite, inverted, out-of-turn, nonpositive-radius or pole-crossing limits; accepted
  // limits clamp the pose and animation endpoint.
  bool setLimits(const OrbitLimits& limits);
  const OrbitLimits& limits() const { return limits_; }

  // Orbit deltas use radians and stop animation at the clamped pose.
  bool orbit(float deltaAzimuth, float deltaElevation);
  // Factors above one move closer and stop animation.
  bool dolly(float factor);

  // Animation takes the shortest permitted azimuth path; zero seconds teleports.
  bool animateTo(const OrbitPose& pose, float seconds);
  bool animating() const { return animation_.has_value(); }

  // Returns whether the pose moved.
  bool update(float dtSeconds);

  splat::Vec3 position() const;
  splat::Mat4 viewMatrix() const;

 private:
  struct Animation {
    OrbitPose from;
    OrbitPose to;
    float elapsed = 0;
    float duration = 0;
  };

  OrbitPose clamped(OrbitPose pose) const;
  bool turnsFreely() const;

  OrbitPose pose_;
  OrbitLimits limits_;
  std::optional<Animation> animation_;
};

}

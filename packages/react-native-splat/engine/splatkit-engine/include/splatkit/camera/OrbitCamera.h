#pragma once

#include <optional>

#include "splat/math/Mat4.h"
#include "splat/math/Vec3.h"

namespace splatkit {

// Where an orbit camera is: `radius` metres from `target`, turned `azimuth` radians about
// +Y from +Z and raised `elevation` radians above the horizontal, looking at the target
// with +Y up on screen.
struct OrbitPose {
  splat::Vec3 target;
  float radius = 1;
  float azimuth = 0;
  float elevation = 0;
};

// The angles and distances a camera may take, radians and metres. The azimuth turns round
// freely while its range is the full circle, the default; a narrower range, which may cross
// pi, keeps the camera on the side that was captured.
struct OrbitLimits {
  static constexpr float kFullTurn = 6.28318530717959f;

  float minAzimuth = -kFullTurn / 2;
  float maxAzimuth = kFullTurn / 2;
  float minElevation = -1.4835f;  // -85 degrees: short of the pole, where up is undefined
  float maxElevation = 1.4835f;
  float minRadius = 0.05f;
  float maxRadius = 1000.0f;
};

// A camera that orbits a target: dragging turns it, pinching moves it closer, and framing
// animates it to a new pose. Every pose it takes is inside its limits. Not thread safe.
class OrbitCamera {
 public:
  // Teleports, clamped to the limits. Stops a running animation. False, changing nothing,
  // for a non-finite pose.
  bool setPose(const OrbitPose& pose);
  const OrbitPose& pose() const { return pose_; }

  // Invalid limits (not finite, min above max, an azimuth range over a full turn or beyond one
  // either side of zero, a radius not above zero or an elevation past the poles) are refused.
  // The pose is clamped into them, and a running animation heads on to its end clamped into
  // them from there.
  bool setLimits(const OrbitLimits& limits);
  const OrbitLimits& limits() const { return limits_; }

  // Turns by radians, stopping at a limit. Stops a running animation, so a drag takes over at
  // once.
  bool orbit(float deltaAzimuth, float deltaElevation);
  // Divides the radius by `factor`, as a pinch scales: above one moves closer. Stops a
  // running animation.
  bool dolly(float factor);

  // Eases to `pose`, clamped to the limits, over `seconds`; the azimuth takes the short way
  // round, or the way inside its limits. Zero seconds teleports.
  bool animateTo(const OrbitPose& pose, float seconds);
  bool animating() const { return animation_.has_value(); }

  // Advances a running animation. True when the pose moved.
  bool update(float dtSeconds);

  splat::Vec3 position() const;
  // World to camera.
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

}  // namespace splatkit

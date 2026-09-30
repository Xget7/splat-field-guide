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

// The angles and distances a camera may take, radians and metres.
struct OrbitLimits {
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

  // Invalid limits (not finite, min above max, a radius not above zero or an elevation past
  // the poles) are refused. The pose and a running animation's end are clamped into them.
  bool setLimits(const OrbitLimits& limits);
  const OrbitLimits& limits() const { return limits_; }

  // Turns by radians. Stops a running animation, so a drag takes over at once.
  bool orbit(float deltaAzimuth, float deltaElevation);
  // Divides the radius by `factor`, as a pinch scales: above one moves closer. Stops a
  // running animation.
  bool dolly(float factor);

  // Eases to `pose`, clamped to the limits, over `seconds`; the azimuth takes the short
  // way round. Zero seconds teleports.
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

  OrbitPose pose_;
  OrbitLimits limits_;
  std::optional<Animation> animation_;
};

}  // namespace splatkit

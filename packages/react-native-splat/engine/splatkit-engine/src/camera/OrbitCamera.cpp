#include "splatkit/camera/OrbitCamera.h"

#include <algorithm>
#include <cmath>

namespace splatkit {
namespace {

constexpr float kPi = 3.14159265358979f;
constexpr float kHalfPi = kPi / 2;
constexpr float kFullTurn = OrbitLimits::kFullTurn;
// An azimuth range this close to a full turn is one: float rounding must not make it a limit.
constexpr float kFullTurnSlack = 1e-4f;

bool finite(splat::Vec3 v) {
  return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

bool finite(const OrbitPose& pose) {
  return finite(pose.target) && std::isfinite(pose.radius) && std::isfinite(pose.azimuth) &&
         std::isfinite(pose.elevation);
}

// From the target towards the camera.
splat::Vec3 direction(const OrbitPose& pose) {
  const float horizontal = std::cos(pose.elevation);
  return {horizontal * std::sin(pose.azimuth), std::sin(pose.elevation),
          horizontal * std::cos(pose.azimuth)};
}

// Looking along -`back` with +Y up on screen, as columns right, up, back.
splat::Mat4 lookRotation(splat::Vec3 back) {
  const splat::Vec3 forward = -back;
  const splat::Vec3 right = splat::normalize(splat::cross(forward, {0, 1, 0}));
  const splat::Vec3 up = splat::cross(right, forward);
  splat::Mat4 r = splat::Mat4::identity();
  for (int i = 0; i < 3; ++i) {
    r.at(i, 0) = right[i];
    r.at(i, 1) = up[i];
    r.at(i, 2) = back[i];
  }
  return r;
}

// Angle in (-pi, pi] equivalent to `radians`.
float wrapped(float radians) {
  return std::remainder(radians, 2 * kPi);
}

float smoothstep(float t) {
  return t * t * (3 - 2 * t);
}

float mix(float a, float b, float t) {
  return a + (b - a) * t;
}

}  // namespace

bool OrbitCamera::turnsFreely() const {
  return limits_.maxAzimuth - limits_.minAzimuth >= kFullTurn - kFullTurnSlack;
}

// Turning freely, the azimuth is kept in (-pi, pi]. Within limits it is the equivalent angle
// nearest the middle of the range, clamped into it: an angle in the gap goes to the nearer end.
OrbitPose OrbitCamera::clamped(OrbitPose pose) const {
  pose.radius = std::clamp(pose.radius, limits_.minRadius, limits_.maxRadius);
  pose.elevation = std::clamp(pose.elevation, limits_.minElevation, limits_.maxElevation);
  if (turnsFreely()) {
    pose.azimuth = wrapped(pose.azimuth);
  } else {
    const float middle = (limits_.minAzimuth + limits_.maxAzimuth) / 2;
    pose.azimuth = std::clamp(middle + wrapped(pose.azimuth - middle), limits_.minAzimuth,
                              limits_.maxAzimuth);
  }
  return pose;
}

bool OrbitCamera::setPose(const OrbitPose& pose) {
  if (!finite(pose)) return false;
  animation_.reset();
  pose_ = clamped(pose);
  return true;
}

bool OrbitCamera::setLimits(const OrbitLimits& limits) {
  const float values[] = {limits.minAzimuth,   limits.maxAzimuth, limits.minElevation,
                          limits.maxElevation, limits.minRadius,  limits.maxRadius};
  for (const float value : values) {
    if (!std::isfinite(value)) return false;
  }
  if (limits.minAzimuth > limits.maxAzimuth || limits.minAzimuth < -kFullTurn ||
      limits.maxAzimuth > kFullTurn ||
      limits.maxAzimuth - limits.minAzimuth > kFullTurn + kFullTurnSlack ||
      limits.minElevation > limits.maxElevation || limits.minElevation <= -kHalfPi ||
      limits.maxElevation >= kHalfPi || limits.minRadius <= 0 ||
      limits.minRadius > limits.maxRadius) {
    return false;
  }
  limits_ = limits;
  pose_ = clamped(pose_);
  if (animation_) {
    const Animation rest = *animation_;
    animation_.reset();
    animateTo(rest.to, rest.duration - rest.elapsed);
  }
  return true;
}

bool OrbitCamera::orbit(float deltaAzimuth, float deltaElevation) {
  if (!std::isfinite(deltaAzimuth) || !std::isfinite(deltaElevation)) return false;
  animation_.reset();
  OrbitPose next = pose_;
  next.azimuth += deltaAzimuth;
  next.elevation += deltaElevation;
  // Within limits a drag stops at the edge; wrapping first could carry it across the gap.
  if (!turnsFreely()) {
    next.azimuth = std::clamp(next.azimuth, limits_.minAzimuth, limits_.maxAzimuth);
  }
  pose_ = clamped(next);
  return true;
}

bool OrbitCamera::dolly(float factor) {
  if (!std::isfinite(factor) || factor <= 0) return false;
  animation_.reset();
  OrbitPose next = pose_;
  next.radius /= factor;
  pose_ = clamped(next);
  return true;
}

bool OrbitCamera::animateTo(const OrbitPose& pose, float seconds) {
  if (!finite(pose) || !std::isfinite(seconds) || seconds < 0) return false;
  if (seconds == 0) return setPose(pose);
  OrbitPose to = clamped(pose);
  // Turning freely, the end is unwrapped next to the start, so interpolating the angle turns
  // the short way. Within limits both ends are inside the range and so is the way between.
  if (turnsFreely()) to.azimuth = pose_.azimuth + wrapped(to.azimuth - pose_.azimuth);
  animation_ = Animation{pose_, to, 0, seconds};
  return true;
}

bool OrbitCamera::update(float dtSeconds) {
  if (!animation_) return false;
  Animation& a = *animation_;
  a.elapsed = std::min(a.elapsed + std::max(dtSeconds, 0.0f), a.duration);
  const float t = smoothstep(a.elapsed / a.duration);
  OrbitPose next;
  next.target = a.from.target + (a.to.target - a.from.target) * t;
  // The distance eases in log space, so a zoom keeps a steady apparent speed.
  next.radius = std::exp(mix(std::log(a.from.radius), std::log(a.to.radius), t));
  next.azimuth = mix(a.from.azimuth, a.to.azimuth, t);
  next.elevation = mix(a.from.elevation, a.to.elevation, t);
  pose_ = clamped(next);
  if (a.elapsed >= a.duration) animation_.reset();
  return true;
}

splat::Vec3 OrbitCamera::position() const {
  return pose_.target + direction(pose_) * pose_.radius;
}

splat::Mat4 OrbitCamera::viewMatrix() const {
  return (splat::Mat4::translation(position()) * lookRotation(direction(pose_))).rigidInverse();
}

}  // namespace splatkit

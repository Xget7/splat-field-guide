#include "splatkit/camera/OrbitCamera.h"

#include <cmath>
#include <limits>

#include <gtest/gtest.h>

namespace splatkit {
namespace {

constexpr float kPi = 3.14159265358979f;
constexpr float kTolerance = 1e-5f;

OrbitPose poseAt(float radius, float azimuth, float elevation, splat::Vec3 target = {}) {
  OrbitPose pose;
  pose.target = target;
  pose.radius = radius;
  pose.azimuth = azimuth;
  pose.elevation = elevation;
  return pose;
}

void expectNear(splat::Vec3 a, splat::Vec3 b) {
  EXPECT_NEAR(a.x, b.x, kTolerance);
  EXPECT_NEAR(a.y, b.y, kTolerance);
  EXPECT_NEAR(a.z, b.z, kTolerance);
}

TEST(OrbitCamera, SitsOnTheSphereAroundItsTargetAndLooksAtIt) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setPose(poseAt(2, 0, 0, {1, 2, 3})));
  expectNear(camera.position(), {1, 2, 5});  // azimuth 0 looks from +Z
  expectNear(camera.viewMatrix().transformPoint({1, 2, 3}), {0, 0, -2});
  expectNear(camera.viewMatrix().transformDirection({0, 1, 0}), {0, 1, 0});

  ASSERT_TRUE(camera.setPose(poseAt(2, kPi / 2, 0.5f, {1, 2, 3})));
  expectNear(camera.viewMatrix().transformPoint({1, 2, 3}), {0, 0, -2});
  EXPECT_GT(camera.position().x, 1);  // a quarter turn about +Y looks from +X
  EXPECT_GT(camera.position().y, 2);
}

TEST(OrbitCamera, KeepsEveryPoseInsideItsLimits) {
  OrbitCamera camera;
  OrbitLimits limits;
  limits.minElevation = -0.5f;
  limits.maxElevation = 1.0f;
  limits.minRadius = 0.5f;
  limits.maxRadius = 3.0f;
  ASSERT_TRUE(camera.setLimits(limits));
  ASSERT_TRUE(camera.setPose(poseAt(10, 0, 1.4f)));
  EXPECT_EQ(camera.pose().radius, 3.0f);
  EXPECT_EQ(camera.pose().elevation, 1.0f);
  ASSERT_TRUE(camera.orbit(0, -5));
  EXPECT_EQ(camera.pose().elevation, -0.5f);
  ASSERT_TRUE(camera.dolly(100));
  EXPECT_EQ(camera.pose().radius, 0.5f);
  limits.maxElevation = -0.25f;
  ASSERT_TRUE(camera.setPose(poseAt(1, 0, 0)));
  ASSERT_TRUE(camera.setLimits(limits));
  EXPECT_EQ(camera.pose().elevation, -0.25f);
}

TEST(OrbitCamera, TurnsTheAzimuthAroundWithoutLimit) {
  OrbitCamera camera;
  for (int i = 0; i < 9; ++i) ASSERT_TRUE(camera.orbit(kPi / 2, 0));
  EXPECT_NEAR(camera.pose().azimuth, kPi / 2, kTolerance);
}

OrbitLimits azimuthBetween(float minAzimuth, float maxAzimuth) {
  OrbitLimits limits;
  limits.minAzimuth = minAzimuth;
  limits.maxAzimuth = maxAzimuth;
  return limits;
}

TEST(OrbitCamera, ADragStopsAtAnAzimuthLimitAndNeverJumpsTheGap) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setLimits(azimuthBetween(-1, 1)));
  ASSERT_TRUE(camera.orbit(0.8f, 0));
  ASSERT_TRUE(camera.orbit(0.8f, 0));
  EXPECT_EQ(camera.pose().azimuth, 1.0f);
  // Wrapping before clamping would jump across the forbidden azimuth gap.
  ASSERT_TRUE(camera.orbit(4, 0));
  EXPECT_EQ(camera.pose().azimuth, 1.0f);
  ASSERT_TRUE(camera.orbit(-3, 0));
  EXPECT_EQ(camera.pose().azimuth, -1.0f);
}

TEST(OrbitCamera, APoseInTheAzimuthGapGoesToTheNearerEnd) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setLimits(azimuthBetween(-1, 1)));
  ASSERT_TRUE(camera.setPose(poseAt(1, 2, 0)));
  EXPECT_EQ(camera.pose().azimuth, 1.0f);
  ASSERT_TRUE(camera.setPose(poseAt(1, 3, 0)));  // 2 past the top end, 2.28 before the bottom
  EXPECT_EQ(camera.pose().azimuth, 1.0f);
  ASSERT_TRUE(camera.setPose(poseAt(1, -2, 0)));
  EXPECT_EQ(camera.pose().azimuth, -1.0f);
  ASSERT_TRUE(camera.setPose(poseAt(1, 2 * kPi - 0.5f, 0)));  // a turn from -0.5, inside
  EXPECT_NEAR(camera.pose().azimuth, -0.5f, kTolerance);
}

TEST(OrbitCamera, AnAzimuthRangeMayCrossPi) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setLimits(azimuthBetween(2.5f, 3.8f)));
  ASSERT_TRUE(camera.setPose(poseAt(2, -3, 0)));
  EXPECT_NEAR(camera.pose().azimuth, 2 * kPi - 3, kTolerance);
  const splat::Vec3 inside = camera.position();
  ASSERT_TRUE(camera.setLimits(OrbitLimits{}));
  ASSERT_TRUE(camera.setPose(poseAt(2, -3, 0)));
  expectNear(camera.position(), inside);
  ASSERT_TRUE(camera.setLimits(azimuthBetween(2.5f, 3.8f)));
  ASSERT_TRUE(camera.orbit(1, 0));
  EXPECT_EQ(camera.pose().azimuth, 3.8f);
}

TEST(OrbitCamera, AnimationTurnsTheWayInsideItsAzimuthLimits) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setLimits(azimuthBetween(-2.5f, 2.5f)));
  ASSERT_TRUE(camera.setPose(poseAt(1, 2.4f, 0)));
  ASSERT_TRUE(camera.animateTo(poseAt(1, -2.4f, 0), 1));
  ASSERT_TRUE(camera.update(0.5f));
  // Through zero, the long way, because the short way through pi is outside the range.
  EXPECT_NEAR(camera.pose().azimuth, 0, kTolerance);
  ASSERT_TRUE(camera.update(0.5f));
  EXPECT_NEAR(camera.pose().azimuth, -2.4f, kTolerance);
}

TEST(OrbitCamera, APinchAboveOneMovesCloser) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setPose(poseAt(4, 0, 0)));
  ASSERT_TRUE(camera.dolly(2));
  EXPECT_EQ(camera.pose().radius, 2.0f);
  ASSERT_TRUE(camera.dolly(0.5f));
  EXPECT_EQ(camera.pose().radius, 4.0f);
}

TEST(OrbitCamera, RefusesNonFiniteInputAndInvalidLimits) {
  constexpr float kNan = std::numeric_limits<float>::quiet_NaN();
  constexpr float kInfinity = std::numeric_limits<float>::infinity();
  OrbitCamera camera;
  ASSERT_TRUE(camera.setPose(poseAt(2, 0.5f, 0.25f)));
  const OrbitPose before = camera.pose();
  EXPECT_FALSE(camera.setPose(poseAt(kNan, 0, 0)));
  EXPECT_FALSE(camera.setPose(poseAt(1, 0, 0, {kInfinity, 0, 0})));
  EXPECT_FALSE(camera.orbit(kNan, 0));
  EXPECT_FALSE(camera.dolly(0));
  EXPECT_FALSE(camera.dolly(-2));
  EXPECT_FALSE(camera.dolly(kInfinity));
  EXPECT_FALSE(camera.animateTo(before, -1));
  EXPECT_FALSE(camera.animateTo(before, kNan));
  EXPECT_EQ(camera.pose().radius, before.radius);
  EXPECT_EQ(camera.pose().azimuth, before.azimuth);
  EXPECT_FALSE(camera.animating());

  OrbitLimits pole;
  pole.maxElevation = kPi / 2;  // up is undefined straight above the target
  EXPECT_FALSE(camera.setLimits(pole));
  OrbitLimits inverted;
  inverted.minRadius = 2;
  inverted.maxRadius = 1;
  EXPECT_FALSE(camera.setLimits(inverted));
  OrbitLimits zero;
  zero.minRadius = 0;
  EXPECT_FALSE(camera.setLimits(zero));
  OrbitLimits notFinite;
  notFinite.maxRadius = kInfinity;
  EXPECT_FALSE(camera.setLimits(notFinite));
  EXPECT_FALSE(camera.setLimits(azimuthBetween(1, -1)));
  EXPECT_FALSE(camera.setLimits(azimuthBetween(-kPi, kPi + 0.1f)));
  EXPECT_FALSE(camera.setLimits(azimuthBetween(2 * kPi + 0.1f, 2 * kPi + 0.2f)));
  EXPECT_FALSE(camera.setLimits(azimuthBetween(kNan, 1)));
  EXPECT_TRUE(camera.setLimits(azimuthBetween(0, 2 * kPi)));  // a full turn from anywhere
}

TEST(OrbitCamera, AnimationEasesToItsEndThenStops) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setPose(poseAt(1, 0, 0, {0, 0, 0})));
  ASSERT_TRUE(camera.animateTo(poseAt(4, 0, 0.5f, {2, 0, 0}), 1));
  EXPECT_TRUE(camera.animating());
  ASSERT_TRUE(camera.update(0.5f));
  // At the eased midpoint the radius halves in log space.
  EXPECT_NEAR(camera.pose().target.x, 1, kTolerance);
  EXPECT_NEAR(camera.pose().elevation, 0.25f, kTolerance);
  EXPECT_NEAR(camera.pose().radius, 2, kTolerance);
  ASSERT_TRUE(camera.update(0.5f));
  EXPECT_FALSE(camera.animating());
  EXPECT_NEAR(camera.pose().target.x, 2, kTolerance);
  EXPECT_NEAR(camera.pose().radius, 4, kTolerance);
  EXPECT_FALSE(camera.update(0.5f));
}

TEST(OrbitCamera, AnimationTurnsTheShortWayRound) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setPose(poseAt(1, 3.0f, 0)));
  ASSERT_TRUE(camera.animateTo(poseAt(1, -3.0f, 0), 1));
  ASSERT_TRUE(camera.update(0.5f));
  // Through pi, 0.28 rad away, rather than through zero, six radians away.
  EXPECT_NEAR(std::abs(camera.pose().azimuth), kPi, 1e-3f);
  ASSERT_TRUE(camera.update(0.5f));
  EXPECT_NEAR(camera.pose().azimuth, -3.0f, kTolerance);
}

TEST(OrbitCamera, ADragOrAPinchTakesOverFromAnAnimation) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.animateTo(poseAt(4, 1, 0), 1));
  ASSERT_TRUE(camera.orbit(0.1f, 0));
  EXPECT_FALSE(camera.animating());
  ASSERT_TRUE(camera.animateTo(poseAt(4, 1, 0), 1));
  ASSERT_TRUE(camera.dolly(2));
  EXPECT_FALSE(camera.animating());
  ASSERT_TRUE(camera.animateTo(poseAt(4, 1, 0), 1));
  ASSERT_TRUE(camera.setPose(poseAt(2, 0, 0)));
  EXPECT_FALSE(camera.animating());
}

TEST(OrbitCamera, ZeroSecondsTeleports) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.animateTo(poseAt(3, 0.5f, 0.25f), 0));
  EXPECT_FALSE(camera.animating());
  EXPECT_EQ(camera.pose().radius, 3.0f);
}

TEST(OrbitCamera, NewLimitsClampARunningAnimationsEnd) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.animateTo(poseAt(10, 0, 0), 1));
  OrbitLimits limits;
  limits.maxRadius = 5;
  ASSERT_TRUE(camera.setLimits(limits));
  camera.update(1);
  EXPECT_EQ(camera.pose().radius, 5.0f);
}

TEST(OrbitCamera, NewAzimuthLimitsTurnARunningAnimationInsideThem) {
  OrbitCamera camera;
  ASSERT_TRUE(camera.setPose(poseAt(1, 2.8f, 0)));
  ASSERT_TRUE(camera.animateTo(poseAt(1, -2.8f, 0), 1));  // the short way, through pi
  ASSERT_TRUE(camera.update(0.25f));
  ASSERT_TRUE(camera.setLimits(azimuthBetween(-2.5f, 2.5f)));
  EXPECT_EQ(camera.pose().azimuth, 2.5f);
  // The rest heads through zero to the nearer end of the new range, never through the gap.
  for (int i = 0; i < 8; ++i) {
    camera.update(0.1f);
    EXPECT_GE(camera.pose().azimuth, -2.5f);
    EXPECT_LE(camera.pose().azimuth, 2.5f);
  }
  EXPECT_FALSE(camera.animating());
  EXPECT_EQ(camera.pose().azimuth, -2.5f);
}

}
}

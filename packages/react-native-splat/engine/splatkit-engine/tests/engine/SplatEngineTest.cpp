#include "splatkit/engine/SplatEngine.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

#include <gtest/gtest.h>

#include "FakeRenderer.h"
#include "TestWorlds.h"

namespace splatkit {
namespace {

using test::FakeRenderer;
using test::kPairPoints;
using test::labelBytes;
using test::pairBytes;
using test::solidPairBytes;

constexpr int64_t kVsyncNanos = 16666667;
constexpr float kTolerance = 1e-4f;
constexpr float kFramingMargin = 1.05f;
constexpr float kMinFramingAspect = 1e-3f;
constexpr std::size_t kBoxCornerCount = 8;
constexpr splat::CoordinateFrame kFrame = splat::CoordinateFrame::rub;
constexpr Extent kLandscape{2000, 1000};
constexpr Extent kPortrait{1000, 2000};

std::array<float, kBoxCornerCount * 3> cornerPoints(const splat::Bounds& bounds) {
  std::array<float, kBoxCornerCount * 3> points;
  std::size_t i = 0;
  for (const float x : {bounds.min[0], bounds.max[0]}) {
    for (const float y : {bounds.min[1], bounds.max[1]}) {
      for (const float z : {bounds.min[2], bounds.max[2]}) {
        points[i++] = x;
        points[i++] = y;
        points[i++] = z;
      }
    }
  }
  return points;
}

struct Events {
  std::vector<SplatEngine::Event> kinds;
  std::vector<uint32_t> counts;
  SplatEngine::EventSink sink() {
    return [this](SplatEngine::Event event, const std::string&, uint32_t count) {
      kinds.push_back(event);
      counts.push_back(count);
    };
  }
};

class SplatEngineTest : public ::testing::Test {
 protected:
  SplatEngineTest() {
    auto owned = std::make_unique<FakeRenderer>();
    renderer = owned.get();
    engine = std::make_unique<SplatEngine>(std::move(owned));
  }

  bool tick() { return engine->render(++vsync * kVsyncNanos); }

  void load(const std::vector<uint8_t>& bytes, const std::vector<uint8_t>& labels = {}) {
    engine->loadWorld({bytes.data(), bytes.size()}, {labels.data(), labels.size()}, kFrame);
  }

  void expectTightFit(const splat::Bounds& bounds) {
    const auto points = cornerPoints(bounds);
    std::array<float, kBoxCornerCount * 2> out;
    ASSERT_EQ(engine->project(points.data(), kBoxCornerCount, out.data()), kBoxCornerCount);
    float maxNdc = 0;
    for (const float uv : out) {
      const float ndc = std::abs(2 * uv - 1);
      EXPECT_LE(ndc, 1 / kFramingMargin + kTolerance);
      maxNdc = std::max(maxNdc, ndc);
    }
    EXPECT_NEAR(maxNdc, 1 / kFramingMargin, kTolerance);
  }

  FakeRenderer* renderer = nullptr;
  std::unique_ptr<SplatEngine> engine;
  int64_t vsync = 0;
};

TEST_F(SplatEngineTest, DrawsOnlyWhenSomethingVisibleChanged) {
  load(pairBytes());
  EXPECT_TRUE(tick());
  EXPECT_FALSE(tick());
  EXPECT_FALSE(tick());
  engine->requestRedraw();
  EXPECT_TRUE(tick());
  ASSERT_TRUE(engine->orbit(0.1f, 0));
  EXPECT_TRUE(tick());
  engine->setShDegree(1);
  EXPECT_TRUE(tick());
  engine->setShDegree(1);
  EXPECT_FALSE(tick());
  ++renderer->surfaceGeneration;  // the surface was rebuilt: the old frame is gone
  EXPECT_TRUE(tick());
  EXPECT_EQ(renderer->frames, 5u);
}

TEST_F(SplatEngineTest, DrawsNothingWithoutASurface) {
  renderer->isReady = false;
  load(pairBytes());
  EXPECT_FALSE(tick());
  EXPECT_EQ(renderer->world(), std::nullopt);
  renderer->isReady = true;
  EXPECT_TRUE(tick());
  EXPECT_NE(renderer->world(), std::nullopt);
}

TEST_F(SplatEngineTest, ReportsAWorldReadyOnceItIsOnScreen) {
  Events events;
  engine->setEventSink(events.sink());
  renderer->gpuFinished = false;
  load(pairBytes());
  EXPECT_TRUE(events.kinds.empty());
  EXPECT_TRUE(tick());
  EXPECT_TRUE(events.kinds.empty());
  EXPECT_TRUE(engine->needsFrame());
  EXPECT_FALSE(tick());
  renderer->gpuFinished = true;
  EXPECT_FALSE(tick());
  ASSERT_EQ(events.kinds, std::vector<SplatEngine::Event>{SplatEngine::Event::worldReady});
  EXPECT_EQ(events.counts[0], 2u);
  EXPECT_FALSE(engine->needsFrame());
}

TEST_F(SplatEngineTest, NeedsFramesOnlyWhileThereIsSomethingToDo) {
  EXPECT_TRUE(engine->needsFrame());  // the first frame clears the view
  tick();
  EXPECT_FALSE(engine->needsFrame());
  load(pairBytes(), labelBytes({1, 0}));
  EXPECT_TRUE(engine->needsFrame());  // a world waits to be uploaded
  tick();
  EXPECT_FALSE(engine->needsFrame());
  ASSERT_TRUE(engine->orbit(0.1f, 0));
  EXPECT_TRUE(engine->needsFrame());
  tick();
  EXPECT_FALSE(engine->needsFrame());
  const uint8_t part = 1;
  engine->setHighlight(&part, 1);
  int frames = 0;
  while (engine->needsFrame()) {
    ASSERT_TRUE(tick());
    ++frames;
  }
  EXPECT_GT(frames, 1);
  ++renderer->surfaceGeneration;
  EXPECT_TRUE(engine->needsFrame());
  renderer->isReady = false;
  EXPECT_FALSE(engine->needsFrame());
}

TEST_F(SplatEngineTest, ReportsAGpuFailureOnceThenRestsForGood) {
  Events events;
  engine->setEventSink(events.sink());
  load(pairBytes());
  tick();
  renderer->gpuFailed = true;
  ASSERT_TRUE(engine->orbit(0.1f, 0));
  EXPECT_TRUE(engine->needsFrame());
  EXPECT_FALSE(tick());
  ASSERT_EQ(events.kinds.back(), SplatEngine::Event::gpuFailed);
  EXPECT_FALSE(engine->needsFrame());
  const size_t reported = events.kinds.size();
  EXPECT_FALSE(tick());
  EXPECT_EQ(events.kinds.size(), reported);
}

TEST_F(SplatEngineTest, ReportsBadBytesAtOnceAndKeepsTheWorld) {
  Events events;
  engine->setEventSink(events.sink());
  load(pairBytes());
  tick();
  const std::vector<uint8_t> garbage(64, 0x5a);
  load(garbage);
  ASSERT_EQ(events.kinds.size(), 2u);
  EXPECT_EQ(events.kinds[1], SplatEngine::Event::worldFailed);
  tick();
  EXPECT_EQ(renderer->world()->count, 2u);
}

TEST_F(SplatEngineTest, ReportsLabelsForAnotherCloudAsTheirOwnFailure) {
  Events events;
  engine->setEventSink(events.sink());
  load(pairBytes(), labelBytes({1, 2, 3}));
  ASSERT_EQ(events.kinds, std::vector<SplatEngine::Event>{SplatEngine::Event::labelsMismatch});
  tick();
  EXPECT_EQ(renderer->world(), std::nullopt);
}

TEST_F(SplatEngineTest, ReportsAFailedUpload) {
  Events events;
  engine->setEventSink(events.sink());
  renderer->failUploads = true;
  load(pairBytes());
  tick();
  ASSERT_EQ(events.kinds, std::vector<SplatEngine::Event>{SplatEngine::Event::worldFailed});
  EXPECT_EQ(renderer->world(), std::nullopt);
}

TEST_F(SplatEngineTest, FramesAWorldWholeFromTheCurrentDirection) {
  load(pairBytes());
  tick();
  const OrbitPose pose = engine->cameraPose();
  EXPECT_NEAR(pose.target.x, 0, kTolerance);
  EXPECT_NEAR(pose.target.z, 2, kTolerance);
  EXPECT_EQ(pose.azimuth, 0.0f);
  // The pair spans two metres across the view, with no depth offset.
  const float expected = kFramingMargin / std::tan(SplatEngine::kFieldOfViewRadians / 2);
  EXPECT_NEAR(pose.radius, expected, kTolerance);
  EXPECT_NEAR(renderer->last.cameraPosition.z, 2 + expected, kTolerance);
}

TEST_F(SplatEngineTest, TheDefaultFramingFollowsTheViewShape) {
  const auto radiusFor = [](Extent atLoad, Extent after) {
    auto owned = std::make_unique<FakeRenderer>();
    FakeRenderer* renderer = owned.get();
    renderer->extent = atLoad;
    SplatEngine engine(std::move(owned));
    const auto bytes = pairBytes();
    engine.loadWorld({bytes.data(), bytes.size()}, {}, kFrame);
    engine.render(1);
    renderer->extent = after;
    engine.render(1 + kVsyncNanos);
    return engine.cameraPose().radius;
  };
  EXPECT_NEAR(radiusFor(kLandscape, kPortrait), radiusFor(kPortrait, kPortrait), kTolerance);
  EXPECT_GT(radiusFor(kPortrait, kPortrait), radiusFor({1000, 1000}, {1000, 1000}));
}

TEST_F(SplatEngineTest, APoseFromTheHostOutlastsTheNextWorld) {
  OrbitPose placed;
  placed.target = {5, 5, 5};
  placed.radius = 3;
  ASSERT_TRUE(engine->setCameraPose(placed));
  load(pairBytes());
  tick();
  renderer->extent = {500, 1000};
  tick();
  EXPECT_EQ(engine->cameraPose().target.x, 5.0f);
  EXPECT_EQ(engine->cameraPose().radius, 3.0f);
}

TEST_F(SplatEngineTest, FramingAPartAnimatesThereThenIdles) {
  load(pairBytes());
  tick();
  splat::Bounds part;
  part.min = {0.5f, -0.5f, 1.5f};
  part.max = {1.5f, 0.5f, 2.5f};
  ASSERT_TRUE(engine->frame(part, 0.1f));
  int drawn = 0;
  while (tick()) ++drawn;
  EXPECT_GE(drawn, 6);
  EXPECT_LE(drawn, 8);
  EXPECT_NEAR(engine->cameraPose().target.x, 1, kTolerance);
  EXPECT_NEAR(engine->cameraPose().target.z, 2, kTolerance);
  EXPECT_FALSE(tick());
}

TEST_F(SplatEngineTest, FramesAPartFromTheDirectionAsked) {
  load(pairBytes());
  tick();
  splat::Bounds part;
  part.min = {0.5f, -0.5f, 1.5f};
  part.max = {1.5f, 0.5f, 2.5f};
  const SplatEngine::ViewDirection from{0.5f, 0.3f};
  ASSERT_TRUE(engine->frame(part, 0.1f, from));
  while (tick()) {
  }
  EXPECT_NEAR(engine->cameraPose().azimuth, from.azimuth, kTolerance);
  EXPECT_NEAR(engine->cameraPose().elevation, from.elevation, kTolerance);
  EXPECT_NEAR(engine->cameraPose().target.x, 1, kTolerance);
}

float fittedRadius(Extent extent, const splat::Bounds& bounds,
                   SplatEngine::ViewDirection from = {}) {
  auto owned = std::make_unique<FakeRenderer>();
  owned->extent = extent;
  SplatEngine engine(std::move(owned));
  EXPECT_TRUE(engine.frame(bounds, 0, from));
  return engine.cameraPose().radius;
}

splat::Bounds unitPart() {
  splat::Bounds part;
  part.min = {0, 0, 0};
  part.max = {1, 1, 1};
  return part;
}

TEST_F(SplatEngineTest, ALongFlatBoxFitsTightlyFromTheRequestedOrCurrentDirection) {
  splat::Bounds part;
  part.min = {2, 1.9f, 3.75f};
  part.max = {4, 2.1f, 4.25f};
  const SplatEngine::ViewDirection from{-0.08f, 0.85f};
  renderer->extent = kPortrait;
  for (const bool requested : {true, false}) {
    SCOPED_TRACE(requested);
    OrbitPose start;
    if (!requested) {
      start.azimuth = from.azimuth;
      start.elevation = from.elevation;
    }
    ASSERT_TRUE(engine->setCameraPose(start));
    ASSERT_TRUE(engine->frame(part, 0, requested ? std::optional{from} : std::nullopt));
    ASSERT_TRUE(tick());
    expectTightFit(part);
  }
}

TEST_F(SplatEngineTest, TheBoxFitIsNeverFartherThanTheOldSphereFit) {
  splat::Bounds flat;
  flat.min = {-1, -0.1f, -0.25f};
  flat.max = {1, 0.1f, 0.25f};
  splat::Bounds tall;
  tall.min = {-0.1f, -2, -0.5f};
  tall.max = {0.1f, 2, 0.5f};
  const SplatEngine::ViewDirection directions[] = {
      {}, {-0.08f, 0.85f}, {1.2f, -0.4f},
      {0.5f, OrbitLimits{}.minElevation}, {-0.5f, OrbitLimits{}.maxElevation}};
  for (const auto& bounds : {flat, tall, unitPart()}) {
    const splat::Vec3 half{(bounds.max[0] - bounds.min[0]) * 0.5f,
                           (bounds.max[1] - bounds.min[1]) * 0.5f,
                           (bounds.max[2] - bounds.min[2]) * 0.5f};
    for (const Extent extent : {kPortrait, kLandscape, Extent{1000, 1000}, Extent{}}) {
      const float aspect = extent.width > 0 && extent.height > 0
                               ? static_cast<float>(extent.width) / extent.height
                               : 1.0f;
      const float halfY = SplatEngine::kFieldOfViewRadians * 0.5f;
      const float halfX = std::atan(std::tan(halfY) * std::max(aspect, kMinFramingAspect));
      const float sphereFit = splat::length(half) * kFramingMargin /
                              std::sin(std::min(halfX, halfY));
      for (const auto from : directions) {
        SCOPED_TRACE(::testing::Message() << "aspect " << aspect << ", azimuth " << from.azimuth
                                         << ", elevation " << from.elevation);
        EXPECT_LE(fittedRadius(extent, bounds, from), sphereFit + kTolerance);
      }
    }
  }
}

TEST_F(SplatEngineTest, AFramingFitsFromTheDirectionAllowedByTheCameraLimits) {
  OrbitLimits limits;
  limits.minAzimuth = -0.1f;
  limits.maxAzimuth = 0.1f;
  limits.minElevation = -0.2f;
  limits.maxElevation = 0.2f;
  ASSERT_TRUE(engine->setCameraLimits(limits));
  renderer->extent = kPortrait;
  ASSERT_TRUE(engine->frame(unitPart(), 0, SplatEngine::ViewDirection{0.5f, 0.8f}));
  ASSERT_TRUE(tick());
  EXPECT_NEAR(engine->cameraPose().azimuth, limits.maxAzimuth, kTolerance);
  EXPECT_NEAR(engine->cameraPose().elevation, limits.maxElevation, kTolerance);
  expectTightFit(unitPart());
}

TEST_F(SplatEngineTest, ATinyBoxKeepsEveryCornerInFrontOfTheNearPlane) {
  splat::Bounds part;
  part.min = {-0.0001f, -0.0001f, -0.01f};
  part.max = {0.0001f, 0.0001f, 0.01f};
  ASSERT_TRUE(engine->frame(part, 0));
  ASSERT_TRUE(tick());
  const auto points = cornerPoints(part);
  float minDepth = engine->cameraPose().radius;
  for (std::size_t i = 0; i < kBoxCornerCount; ++i) {
    const float depth = -renderer->last.view.transformPoint(
        {points[i * 3], points[i * 3 + 1], points[i * 3 + 2]}).z;
    EXPECT_GE(depth, SplatEngine::kNearPlane - kTolerance);
    minDepth = std::min(minDepth, depth);
  }
  EXPECT_NEAR(minDepth, SplatEngine::kNearPlane, kTolerance);
}

TEST_F(SplatEngineTest, AZeroSizeBoxStillUsesTheMinimumCameraRadius) {
  OrbitLimits limits;
  limits.minRadius = SplatEngine::kNearPlane * 0.5f;
  ASSERT_TRUE(engine->setCameraLimits(limits));
  splat::Bounds part;
  part.min = part.max = {3, 2, 4};
  ASSERT_TRUE(engine->frame(part, 0));
  EXPECT_EQ(engine->cameraPose().radius, limits.minRadius);
  EXPECT_EQ(engine->cameraPose().target.x, part.min[0]);
  EXPECT_EQ(engine->cameraPose().target.y, part.min[1]);
  EXPECT_EQ(engine->cameraPose().target.z, part.min[2]);
}

TEST_F(SplatEngineTest, AFramingBeforeTheViewHasASizeGoesThereAtOnceAndFitsItLater) {
  renderer->extent = {};
  ASSERT_TRUE(engine->frame(unitPart(), 1));
  EXPECT_NEAR(engine->cameraPose().target.x, 0.5f, kTolerance);  // no easing from nowhere
  renderer->extent = kPortrait;
  tick();
  EXPECT_NEAR(engine->cameraPose().radius, fittedRadius(kPortrait, unitPart()), kTolerance);
}

TEST_F(SplatEngineTest, AFramingHoldsThroughAChangeOfShapeButNotAPinch) {
  renderer->extent = kLandscape;
  ASSERT_TRUE(engine->frame(unitPart(), 0.1f));
  while (tick()) {
  }
  ASSERT_TRUE(engine->orbit(0.2f, 0));  // resizing must refit from the direction after the turn
  renderer->extent = kPortrait;
  ++renderer->surfaceGeneration;
  tick();
  const OrbitPose pose = engine->cameraPose();
  EXPECT_NEAR(pose.radius, fittedRadius(kPortrait, unitPart(), {pose.azimuth, pose.elevation}),
              kTolerance);
  ASSERT_TRUE(engine->dolly(2));
  const float pinched = engine->cameraPose().radius;
  renderer->extent = kLandscape;
  ++renderer->surfaceGeneration;
  tick();
  EXPECT_EQ(engine->cameraPose().radius, pinched);
}

TEST_F(SplatEngineTest, AChangeOfShapeDuringAFramingIsFittedAsItEnds) {
  renderer->extent = kLandscape;
  ASSERT_TRUE(engine->frame(unitPart(), 0.1f));
  tick();
  renderer->extent = kPortrait;
  ++renderer->surfaceGeneration;
  while (engine->needsFrame()) tick();
  EXPECT_NEAR(engine->cameraPose().radius, fittedRadius(kPortrait, unitPart()), kTolerance);
}

TEST_F(SplatEngineTest, AStallStepsTheAnimationByAtMostATenthOfASecond) {
  load(pairBytes());
  tick();
  splat::Bounds part;
  part.min = {10, 0, 0};
  part.max = {11, 1, 1};
  ASSERT_TRUE(engine->frame(part, 1));
  tick();
  const float start = engine->cameraPose().target.x;
  engine->render((vsync + 300) * kVsyncNanos);  // five seconds later
  EXPECT_LT(engine->cameraPose().target.x, start + (10.5f - start) * 0.1f);
}

TEST_F(SplatEngineTest, TimeStandsStillWhileTheEngineRests) {
  load(pairBytes(), labelBytes({4, 0}));
  while (engine->needsFrame()) tick();
  vsync += 300;  // the host stops its display link for five seconds
  const uint8_t part = 4;
  engine->setHighlight(&part, 1);
  ASSERT_TRUE(tick());
  EXPECT_EQ((*renderer->last.labelStyles)[4].tintAmount, 0.0f);  // the fade's first frame
  int drawn = 1;
  while (tick()) ++drawn;
  EXPECT_GE(drawn, 15);  // the whole quarter second
  EXPECT_LE(drawn, 17);
}

TEST_F(SplatEngineTest, RefusesToFrameNonFiniteBounds) {
  splat::Bounds bad;
  bad.min = {0, 0, NAN};
  EXPECT_FALSE(engine->frame(bad, 1));
  splat::Bounds inverted;
  inverted.min = {1, 1, 1};
  EXPECT_FALSE(engine->frame(inverted, 1));
}

TEST_F(SplatEngineTest, AHighlightFadesInThenTheEngineIdles) {
  load(pairBytes(), labelBytes({4, 0}));
  tick();
  ASSERT_NE(renderer->last.labelStyles, nullptr);
  EXPECT_EQ((*renderer->last.labelStyles)[4].tintAmount, 0.0f);
  const uint8_t part = 4;
  engine->setHighlight(&part, 1);
  int drawn = 0;
  while (tick()) ++drawn;
  EXPECT_GE(drawn, 15);
  EXPECT_LE(drawn, 17);
  EXPECT_EQ((*renderer->last.labelStyles)[4].tintAmount, Highlight::kTintAmount);
  EXPECT_EQ((*renderer->last.labelStyles)[0].brightness, Highlight::kDimBrightness);
  EXPECT_FALSE(tick());
}

TEST_F(SplatEngineTest, TheProjectionFollowsTheDrawExtent) {
  renderer->extent = {500, 1000};
  load(pairBytes());
  tick();
  const splat::Mat4& proj = renderer->last.proj;
  EXPECT_NEAR(proj.at(0, 0) / proj.at(1, 1), 2.0f, kTolerance);  // aspect one half
  EXPECT_NEAR(proj.at(1, 1), 1 / std::tan(SplatEngine::kFieldOfViewRadians / 2), kTolerance);
}

TEST_F(SplatEngineTest, PicksThePartWhereAPointShowsInTheLastFrame) {
  load(solidPairBytes(), labelBytes({1, 2}));
  EXPECT_EQ(engine->pick(0.5f, 0.5f), 0);
  ASSERT_TRUE(tick());
  // Framed whole from +Z: the splat at -x shows left of the centre, both on the horizon.
  float at[4];
  ASSERT_EQ(engine->project(kPairPoints, 2, at), 2u);
  EXPECT_LT(at[0], 0.5f);
  EXPECT_GT(at[2], 0.5f);
  EXPECT_NEAR(at[1], 0.5f, kTolerance);
  EXPECT_NEAR(at[0] + at[2], 1, kTolerance);
  EXPECT_EQ(engine->pick(at[0], at[1]), 1);
  EXPECT_EQ(engine->pick(at[2], at[3]), 2);
  EXPECT_EQ(engine->pick(0.5f, 0.5f), 0);  // the gap between them
  ASSERT_TRUE(engine->orbit(0.3f, 0.2f));
  ASSERT_TRUE(tick());
  ASSERT_EQ(engine->project(kPairPoints, 2, at), 2u);
  EXPECT_EQ(engine->pick(at[0], at[1]), 1);  // still, from wherever the camera went
}

TEST_F(SplatEngineTest, ProjectsTheTargetToTheCentreAndNothingBehindTheCamera) {
  load(pairBytes());
  const float target[] = {0, 0, 2};
  float at[2];
  EXPECT_EQ(engine->project(target, 1, at), 0u);
  EXPECT_TRUE(std::isnan(at[0]) && std::isnan(at[1]));
  ASSERT_TRUE(tick());
  const OrbitPose pose = engine->cameraPose();
  const float points[] = {0, 0, 2, 0, 0, 2 + 2 * pose.radius};
  float out[4];
  EXPECT_EQ(engine->project(points, 2, out), 1u);
  EXPECT_NEAR(out[0], 0.5f, kTolerance);
  EXPECT_NEAR(out[1], 0.5f, kTolerance);
  EXPECT_TRUE(std::isnan(out[2]) && std::isnan(out[3]));
}

TEST_F(SplatEngineTest, ReportsTheDirectionOfTheFrameLastDrawn) {
  load(pairBytes());
  float azimuth = 0;
  float elevation = 0;
  EXPECT_FALSE(engine->drawnDirection(azimuth, elevation));
  ASSERT_TRUE(tick());
  ASSERT_TRUE(engine->orbit(0.3f, 0.2f));
  const OrbitPose orbited = engine->cameraPose();
  ASSERT_TRUE(engine->drawnDirection(azimuth, elevation));
  EXPECT_NE(azimuth, orbited.azimuth);  // the orbit is not on screen until the next frame
  ASSERT_TRUE(tick());
  ASSERT_TRUE(engine->drawnDirection(azimuth, elevation));
  EXPECT_EQ(azimuth, orbited.azimuth);
  EXPECT_EQ(elevation, orbited.elevation);
}

TEST_F(SplatEngineTest, PickSeesANewWorldOnlyOnceItIsDrawn) {
  load(solidPairBytes(), labelBytes({1, 2}));
  ASSERT_TRUE(tick());
  float at[4];
  ASSERT_EQ(engine->project(kPairPoints, 2, at), 2u);
  load(solidPairBytes(), labelBytes({3, 4}));
  EXPECT_EQ(engine->pick(at[0], at[1]), 1);  // the frame on screen is still the old world
  ASSERT_TRUE(tick());
  EXPECT_EQ(engine->pick(at[0], at[1]), 3);
  load(solidPairBytes());
  ASSERT_TRUE(tick());
  EXPECT_EQ(engine->pick(at[0], at[1]), 0);
}

}
}

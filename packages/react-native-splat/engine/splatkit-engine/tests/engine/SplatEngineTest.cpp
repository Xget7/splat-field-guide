#include "splatkit/engine/SplatEngine.h"

#include <cmath>
#include <vector>

#include <gtest/gtest.h>

#include "load-spz.h"
#include "splat/formats/PartLabels.h"

namespace splatkit {
namespace {

constexpr int64_t kVsyncNanos = 16666667;
constexpr float kTolerance = 1e-4f;
constexpr splat::CoordinateFrame kFrame = splat::CoordinateFrame::rub;

// Records what the engine asks of a platform renderer.
class FakeRenderer final : public SplatRenderer {
 public:
  void setRenderScale(float scale) override { scale_ = scale; }
  float renderScale() const override { return scale_; }
  bool ready() const override { return isReady; }
  Extent drawExtent() const override { return extent; }
  uint32_t generation() const override { return surfaceGeneration; }
  bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) override {
    if (failUploads) return false;
    world_ = GpuWorldInfo{static_cast<uint32_t>(cloud.count()), std::min(cloud.shDegree, maxShDegree)};
    return true;
  }
  std::optional<GpuWorldInfo> world() const override { return world_; }
  bool draw(const Frame& frame) override {
    last = frame;
    ++frames;
    return true;
  }
  double lastGpuMillis() const override { return 0; }
  const std::string& deviceDescription() const override { return description_; }

  bool isReady = true;
  bool failUploads = false;
  Extent extent{1000, 1000};
  uint32_t surfaceGeneration = 0;
  Frame last;
  uint32_t frames = 0;

 private:
  float scale_ = 1;
  std::optional<GpuWorldInfo> world_;
  std::string description_ = "fake";
};

// Splats at `positions` (x, y, z each) in an SPZ file, one metre across and half opaque
// unless told otherwise.
std::vector<uint8_t> worldBytes(std::vector<float> positions, float logScale = 0,
                                float alphaLogit = 0) {
  spz::GaussianCloud cloud;
  cloud.numPoints = static_cast<int>(positions.size() / 3);
  cloud.positions = std::move(positions);
  cloud.scales.assign(cloud.positions.size(), logScale);
  cloud.rotations.clear();
  for (int i = 0; i < cloud.numPoints; ++i) cloud.rotations.insert(cloud.rotations.end(), {0, 0, 0, 1});
  cloud.alphas.assign(static_cast<size_t>(cloud.numPoints), alphaLogit);
  cloud.colors.assign(cloud.positions.size(), 0);
  spz::PackOptions options;
  options.version = 2;
  std::vector<uint8_t> bytes;
  EXPECT_TRUE(spz::saveSpz(cloud, options, &bytes));
  return bytes;
}

// Two splats 2 m apart around (0, 0, 2).
std::vector<uint8_t> pairBytes() {
  return worldBytes({-1, 0, 2, 1, 0, 2});
}

// The same pair as small opaque splats, 5 cm across, that a tap can tell apart.
constexpr float kSmallLogScale = -3.0f;
constexpr float kOpaqueLogit = 5.0f;
constexpr float kPairPoints[] = {-1, 0, 2, 1, 0, 2};
std::vector<uint8_t> solidPairBytes() {
  return worldBytes({std::begin(kPairPoints), std::end(kPairPoints)}, kSmallLogScale, kOpaqueLogit);
}

// A labels.bin giving these labels to the splats in order.
std::vector<uint8_t> labelBytes(const std::vector<uint8_t>& labels) {
  std::vector<uint8_t> bytes(splat::part_labels::kHeaderBytes, 0);
  std::copy(std::begin(splat::part_labels::kMagic), std::end(splat::part_labels::kMagic),
            bytes.begin());
  bytes[4] = splat::part_labels::kVersion;
  bytes[6] = splat::part_labels::kBytesPerLabel;
  bytes[8] = static_cast<uint8_t>(labels.size());
  bytes.insert(bytes.end(), labels.begin(), labels.end());
  return bytes;
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

  // Renders the next vsync.
  bool tick() { return engine->render(++vsync * kVsyncNanos); }

  void load(const std::vector<uint8_t>& bytes, const std::vector<uint8_t>& labels = {}) {
    engine->loadWorld({bytes.data(), bytes.size()}, {labels.data(), labels.size()}, kFrame);
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
  EXPECT_EQ(renderer->world(), std::nullopt);  // the upload waits for the surface too
  renderer->isReady = true;
  EXPECT_TRUE(tick());
  EXPECT_NE(renderer->world(), std::nullopt);
}

TEST_F(SplatEngineTest, ReportsAWorldReadyOnceItIsUploaded) {
  Events events;
  engine->setEventSink(events.sink());
  load(pairBytes());
  EXPECT_TRUE(events.kinds.empty());  // decoded, not yet drawn from
  tick();
  ASSERT_EQ(events.kinds, std::vector<SplatEngine::Event>{SplatEngine::Event::worldReady});
  EXPECT_EQ(events.counts[0], 2u);
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
  // The pair's bounding sphere, radius 1, fits the 65 degree field of view with a margin.
  const float expected = 1.05f / std::sin(SplatEngine::kFieldOfViewRadians / 2);
  EXPECT_NEAR(pose.radius, expected, kTolerance);
  // What the frame draws is where the camera is.
  EXPECT_NEAR(renderer->last.cameraPosition.z, 2 + expected, kTolerance);
}

// A phone that turns to portrait while a world loads must end up where one held in
// portrait all along does.
TEST_F(SplatEngineTest, TheDefaultFramingFollowsTheViewShape) {
  constexpr Extent kPortrait{1000, 2000};
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
  EXPECT_NEAR(radiusFor({2000, 1000}, kPortrait), radiusFor(kPortrait, kPortrait), kTolerance);
  // Narrower is further away.
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
  EXPECT_GE(drawn, 5);  // six vsyncs of 16.7 ms, the last reaching the end
  EXPECT_LE(drawn, 7);
  EXPECT_NEAR(engine->cameraPose().target.x, 1, kTolerance);
  EXPECT_NEAR(engine->cameraPose().target.z, 2, kTolerance);
  EXPECT_FALSE(tick());
}

TEST_F(SplatEngineTest, AStallStepsTheAnimationByAtMostATenthOfASecond) {
  load(pairBytes());
  tick();
  splat::Bounds part;
  part.min = {10, 0, 0};
  part.max = {11, 1, 1};
  ASSERT_TRUE(engine->frame(part, 1));
  const float start = engine->cameraPose().target.x;
  engine->render((vsync + 300) * kVsyncNanos);  // five seconds later
  EXPECT_LT(engine->cameraPose().target.x, start + (10.5f - start) * 0.1f);
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
  EXPECT_EQ((*renderer->last.labelStyles)[4].tintAmount, 0.0f);  // as captured until asked
  const uint8_t part = 4;
  engine->setHighlight(&part, 1);
  int drawn = 0;
  while (tick()) ++drawn;
  // A quarter second of 16.7 ms vsyncs.
  EXPECT_GE(drawn, 14);
  EXPECT_LE(drawn, 16);
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
  EXPECT_EQ(engine->pick(0.5f, 0.5f), 0);  // nothing drawn yet
  ASSERT_TRUE(tick());
  // Framed whole from +Z: the splat at -x shows left of the centre, both on the horizon.
  float at[4];
  ASSERT_EQ(engine->project(kPairPoints, 2, at), 2u);
  EXPECT_LT(at[0], 0.5f);
  EXPECT_GT(at[2], 0.5f);
  EXPECT_NEAR(at[1], 0.5f, kTolerance);
  EXPECT_NEAR(at[0] + at[2], 1, kTolerance);
  // The labels were reordered with their splats, so each point picks its own part.
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
  EXPECT_EQ(engine->project(target, 1, at), 0u);  // nothing drawn yet
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
  EXPECT_EQ(engine->pick(at[0], at[1]), 0);  // an unlabelled world picks nothing
}

}  // namespace
}  // namespace splatkit

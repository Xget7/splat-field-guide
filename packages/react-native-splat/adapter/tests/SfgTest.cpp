#include "sfg/sfg.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <fstream>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include <gtest/gtest.h>

#include "FakeRenderer.h"
#include "TestWorlds.h"
#include "sfg/sfg_platform.h"

namespace splatkit {
namespace {

using test::FakeRenderer;
using test::kPairPoints;
using test::labelBytes;
using test::pairBytes;
using test::solidPairBytes;

bool loadReserved(sfg_engine* engine, const char* world, const char* labels) {
  return sfg_load_request(engine, sfg_begin_load(engine), world, labels, nullptr);
}
constexpr int64_t kVsyncNanos = 16666667;
constexpr float kTolerance = 1e-4f;
// The engine keeps the camera 85 degrees from the horizon at most.
constexpr float kEngineMaxElevation = 1.48352986f;
constexpr float kFieldGuideRenderScale = 0.75f;
// SHA-256 of solidPairBytes() and labelBytes({kRootPart, 1, 2}), calculated independently with
// Python hashlib. The tree is written by hand, so its bytes are the same on every platform.
constexpr char kSolidPairSha256[] =
    "4256dedff9e570e2a67bbfa035ffeb5b749fffdd67a5cf5fee6e1101acd11b23";
constexpr char kPairLabelsSha256[] =
    "94ddf9ec7f5f448cf2f89299fba456e08c68b884c5a383c3e13f523dba569e66";
// The pair is a three-node tree: its merged root, then its two leaves.
constexpr uint32_t kPairLeaves = 2;
// A root label the leaves do not carry, so a pick that hit the root would show.
constexpr uint8_t kRootPart = 9;

std::string writeFile(const std::string& name, const std::vector<uint8_t>& bytes) {
  const std::string path = test::temporaryDirectory() + name;
  std::ofstream(path, std::ios::binary)
      .write(reinterpret_cast<const char*>(bytes.data()),
             static_cast<std::streamsize>(bytes.size()));
  return path;
}

struct Event {
  sfg_event kind;
  std::string message;
  uint32_t count;
};

class SfgTest : public ::testing::Test {
 protected:
  SfgTest() {
    auto owned = std::make_unique<FakeRenderer>();
    renderer = owned.get();
    engine = makeSfgEngine(std::move(owned));
    sfg_set_event_callback(
        engine,
        [](void* context, sfg_event kind, const char* message, uint32_t count) {
          static_cast<std::vector<Event>*>(context)->push_back({kind, message, count});
        },
        &events);
  }
  ~SfgTest() override { sfg_destroy(engine); }
  SfgTest(const SfgTest&) = delete;
  SfgTest& operator=(const SfgTest&) = delete;

  bool draw() { return sfg_draw(engine, ++vsync * kVsyncNanos); }
  void settle() {
    for (int i = 0; i < 600 && sfg_needs_frame(engine); ++i) draw();
    ASSERT_FALSE(sfg_needs_frame(engine));
  }

  FakeRenderer* renderer = nullptr;
  sfg_engine* engine = nullptr;
  std::vector<Event> events;
  int64_t vsync = 0;
};

TEST_F(SfgTest, CallbackCanRemoveItselfAndReenterLoading) {
  struct Context {
    sfg_engine* engine;
    int calls = 0;
  } context{engine};
  sfg_set_event_callback(
      engine,
      [](void* raw, sfg_event kind, const char*, uint32_t) {
        auto& state = *static_cast<Context*>(raw);
        EXPECT_EQ(kind, SFG_EVENT_LOAD_FAILED);
        ++state.calls;
        sfg_set_event_callback(state.engine, nullptr, nullptr);
        EXPECT_FALSE(loadReserved(state.engine, "/missing/reentrant.lodsplat", nullptr));
      },
      &context);
  EXPECT_FALSE(loadReserved(engine, "/missing/world.lodsplat", nullptr));
  EXPECT_EQ(context.calls, 1);
}

TEST_F(SfgTest, TeardownCanClearCallbackDuringWorkerFailure) {
  struct Context {
    std::promise<void> entered;
    std::shared_future<void> release;
    int calls = 0;
  };
  std::promise<void> release;
  Context context{{}, release.get_future().share(), 0};
  sfg_set_event_callback(
      engine,
      [](void* raw, sfg_event kind, const char*, uint32_t) {
        auto& state = *static_cast<Context*>(raw);
        EXPECT_EQ(kind, SFG_EVENT_LOAD_FAILED);
        ++state.calls;
        state.entered.set_value();
        state.release.wait();
      },
      &context);
  auto load = std::async(std::launch::async,
                         [&] { return loadReserved(engine, "/missing/worker.lodsplat", nullptr); });
  context.entered.get_future().wait();
  auto clear =
      std::async(std::launch::async, [&] { sfg_set_event_callback(engine, nullptr, nullptr); });
  EXPECT_EQ(clear.wait_for(std::chrono::seconds(2)), std::future_status::ready);
  release.set_value();
  EXPECT_FALSE(load.get());
  clear.get();
  EXPECT_FALSE(loadReserved(engine, "/missing/after-clear.lodsplat", nullptr));
  EXPECT_EQ(context.calls, 1);
}

TEST_F(SfgTest, CallbackReplacementRacesWorkerFailuresSafely) {
  std::atomic<int> calls{0};
  const auto callback = [](void* raw, sfg_event, const char*, uint32_t) {
    ++*static_cast<std::atomic<int>*>(raw);
  };
  auto load = std::async(std::launch::async, [&] {
    for (int i = 0; i < 200; ++i) loadReserved(engine, "/missing/racing.lodsplat", nullptr);
  });
  for (int i = 0; i < 200; ++i) {
    sfg_set_event_callback(engine, callback, &calls);
    sfg_set_event_callback(engine, nullptr, nullptr);
  }
  load.get();
  sfg_set_event_callback(engine, callback, &calls);
  EXPECT_FALSE(loadReserved(engine, "/missing/final.lodsplat", nullptr));
  EXPECT_GT(calls.load(), 0);
  sfg_set_event_callback(engine, nullptr, nullptr);
}

TEST_F(SfgTest, DrawsTheSplatsBelowFullResolution) {
  EXPECT_FLOAT_EQ(renderer->renderScale(), kFieldGuideRenderScale);
}

TEST_F(SfgTest, LoadsAPackAndSaysWhenItIsOnScreen) {
  const std::string world = writeFile("pair.lodsplat", pairBytes());
  const std::string labels = writeFile("pair.labels.bin", labelBytes({kRootPart, 1, 2}));
  ASSERT_TRUE(loadReserved(engine, world.c_str(), labels.c_str()));
  EXPECT_TRUE(events.empty());
  EXPECT_TRUE(sfg_needs_frame(engine));
  EXPECT_TRUE(draw());
  // The complete three-node tree is uploaded, while frame selection uses the host budget.
  ASSERT_TRUE(renderer->world().has_value());
  EXPECT_EQ(renderer->world()->count, kPairLeaves + 1);
  EXPECT_EQ(renderer->uploadedBudget, 1'500'000u);
  draw();  // Poll completion after the submitted frame.
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_WORLD_READY);
  EXPECT_EQ(events[0].message, "");
  EXPECT_EQ(events[0].count, kPairLeaves);
  EXPECT_FALSE(sfg_needs_frame(engine));
}

TEST_F(SfgTest, RejectsUnrelatedLabelsWithTheSameSplatCount) {
  const std::string world = writeFile("solid.lodsplat", solidPairBytes());
  const std::string labels = writeFile("solid.labels.bin", labelBytes({kRootPart, 1, 2}));
  const sfg_source_identity identity{kSolidPairSha256, kPairLabelsSha256, kPairLeaves};
  ASSERT_TRUE(
      sfg_load_request(engine, sfg_begin_load(engine), world.c_str(), labels.c_str(), &identity));
  ASSERT_TRUE(draw());
  events.clear();
  const std::string otherLabels = writeFile("other.labels.bin", labelBytes({kRootPart, 3, 4}));
  EXPECT_FALSE(sfg_load_request(engine, sfg_begin_load(engine), world.c_str(), otherLabels.c_str(),
                                &identity));
  draw();
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_LABELS_MISMATCH);
  float at[4];
  ASSERT_EQ(sfg_project(engine, kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 1);
  EXPECT_EQ(sfg_pick(engine, at[2], at[3]), 2);
}

TEST_F(SfgTest, RejectsAWorldWhoseDigestOrLeafCountDisagreesWithTheManifest) {
  const std::string world = writeFile("solid.lodsplat", solidPairBytes());
  const std::string other = writeFile("other.lodsplat", pairBytes());
  const std::string labels = writeFile("solid.labels.bin", labelBytes({kRootPart, 1, 2}));
  sfg_source_identity identity{kSolidPairSha256, kPairLabelsSha256, kPairLeaves};
  EXPECT_FALSE(
      sfg_load_request(engine, sfg_begin_load(engine), other.c_str(), labels.c_str(), &identity));
  // The manifest counts the leaves, so the node count is the wrong number.
  identity.expected_splat_count = 3;
  EXPECT_FALSE(
      sfg_load_request(engine, sfg_begin_load(engine), world.c_str(), labels.c_str(), &identity));
  draw();
  EXPECT_FALSE(renderer->world().has_value());
  ASSERT_EQ(events.size(), 2u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_LOAD_FAILED);
  EXPECT_EQ(events[1].kind, SFG_EVENT_LOAD_FAILED);
}

TEST_F(SfgTest, SupersededLoadsCannotReplaceTheWorldOrReportAnOutcome) {
  const std::string world = writeFile("solid.lodsplat", solidPairBytes());
  const std::string labels = writeFile("solid.labels.bin", labelBytes({kRootPart, 1, 2}));
  const uint64_t old = sfg_begin_load(engine);
  const uint64_t current = sfg_begin_load(engine);
  EXPECT_FALSE(sfg_load_request(engine, old, world.c_str(), labels.c_str(), nullptr));
  EXPECT_FALSE(sfg_load_request(engine, old, "missing.lodsplat", nullptr, nullptr));
  draw();
  EXPECT_FALSE(renderer->world().has_value());
  EXPECT_TRUE(events.empty());
  ASSERT_TRUE(sfg_load_request(engine, current, world.c_str(), labels.c_str(), nullptr));
  ASSERT_TRUE(draw());
  draw();  // Poll completion after the submitted frame.
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_WORLD_READY);
  float at[4];
  ASSERT_EQ(sfg_project(engine, kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 1);
}


TEST_F(SfgTest, AReplacementSuppressesPendingUploadAndGpuCompletion) {
  const std::string world = writeFile("pair.lodsplat", pairBytes());
  ASSERT_TRUE(loadReserved(engine, world.c_str(), nullptr));
  sfg_begin_load(engine);
  draw();
  EXPECT_FALSE(renderer->world().has_value());
  EXPECT_TRUE(events.empty());
  renderer->gpuFinished = false;
  ASSERT_TRUE(loadReserved(engine, world.c_str(), nullptr));
  ASSERT_TRUE(draw());
  sfg_begin_load(engine);
  renderer->gpuFinished = true;
  draw();
  EXPECT_TRUE(events.empty());
}

TEST_F(SfgTest, ALoadWithoutLabelsIsAWorldWithNoParts) {
  const std::string world = writeFile("solid.lodsplat", solidPairBytes());
  ASSERT_TRUE(loadReserved(engine, world.c_str(), nullptr));
  ASSERT_TRUE(draw());
  float at[4];
  ASSERT_EQ(sfg_project(engine, kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 0);
}

TEST_F(SfgTest, RefusesLabelsCountedByLeaves) {
  const std::string world = writeFile("pair.lodsplat", pairBytes());
  // One label per leaf counts the cloud the tree was built from, not the tree's nodes.
  const std::string labels = writeFile("leaves.labels.bin", labelBytes({1, 2}));
  EXPECT_FALSE(loadReserved(engine, world.c_str(), labels.c_str()));
  draw();
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_LABELS_MISMATCH);
  EXPECT_FALSE(renderer->world().has_value());
}

TEST_F(SfgTest, ReportsAMissingWorldAsAFailedLoad) {
  EXPECT_FALSE(loadReserved(engine, (::testing::TempDir() + "missing.lodsplat").c_str(), nullptr));
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_LOAD_FAILED);
  EXPECT_FALSE(events[0].message.empty());
}

TEST_F(SfgTest, ReportsAGpuFailure) {
  renderer->gpuFailure = true;
  draw();
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_GPU_FAILED);
}

TEST_F(SfgTest, PicksAndProjectsTheLastFrame) {
  const std::string world = writeFile("solid.lodsplat", solidPairBytes());
  const std::string labels = writeFile("solid.labels.bin", labelBytes({kRootPart, 1, 2}));
  ASSERT_TRUE(loadReserved(engine, world.c_str(), labels.c_str()));
  ASSERT_TRUE(draw());
  float at[4];
  ASSERT_EQ(sfg_project(engine, kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 1);
  EXPECT_EQ(sfg_pick(engine, at[2], at[3]), 2);
}




TEST_F(SfgTest, HighlightsAndClearsParts) {
  const std::string world = writeFile("pair.lodsplat", pairBytes());
  const std::string labels = writeFile("pair.labels.bin", labelBytes({1, 1, 0}));
  ASSERT_TRUE(loadReserved(engine, world.c_str(), labels.c_str()));
  settle();
  const uint16_t part = 1;
  sfg_set_highlight(engine, &part, 1);
  settle();
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, HighlightLook{}.tintAmount);
  sfg_set_highlight(engine, nullptr, 0);
  settle();
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, 0.0f);
}

TEST_F(SfgTest, TheHostsHighlightLookStylesPartsAndRejectsOutOfRangeValues) {
  const std::string world = writeFile("pair.lodsplat", pairBytes());
  const std::string labels = writeFile("pair.labels.bin", labelBytes({1, 1, 0}));
  ASSERT_TRUE(loadReserved(engine, world.c_str(), labels.c_str()));
  constexpr float kTintAmount = 0.5f;
  constexpr float kOverBright = 3;
  const sfg_highlight_look look{0x2A5BD7, kTintAmount, 1.2f, 1.0f};
  ASSERT_TRUE(sfg_set_highlight_look(engine, &look));
  sfg_highlight_look tooBright = look;
  tooBright.other_brightness = kOverBright;
  EXPECT_FALSE(sfg_set_highlight_look(engine, &tooBright));
  sfg_highlight_look notRgb = look;
  notRgb.tint_rgb = 0x1000000;
  EXPECT_FALSE(sfg_set_highlight_look(engine, &notRgb));
  const uint16_t part = 1;
  sfg_set_highlight(engine, &part, 1);
  settle();
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, kTintAmount);
  ASSERT_TRUE(sfg_set_highlight_look(engine, nullptr));
  settle();
  EXPECT_FLOAT_EQ((*renderer->last.labelStyles)[1].tintAmount, HighlightLook{}.tintAmount);
}

TEST_F(SfgTest, AHighlightOutlivesTheWorldsLoadedAfterIt) {
  const uint16_t part = 1;
  sfg_set_highlight(engine, &part, 1);
  const std::string world = writeFile("pair.lodsplat", pairBytes());
  const std::string labels = writeFile("pair.labels.bin", labelBytes({1, 1, 0}));
  // The host sets its highlight with its first props, before the world it describes exists.
  ASSERT_TRUE(loadReserved(engine, world.c_str(), labels.c_str()));
  settle();
  ASSERT_NE(renderer->last.labelStyles, nullptr);
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, HighlightLook{}.tintAmount);
  ASSERT_TRUE(loadReserved(engine, world.c_str(), labels.c_str()));
  settle();
  ASSERT_NE(renderer->last.labelStyles, nullptr);
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, HighlightLook{}.tintAmount);
}

}  // namespace
}  // namespace splatkit

namespace splatkit {
namespace {
TEST_F(SfgTest, QueriesBeforePublicationAndAfterCameraInput) {
  sfg_view_direction direction{7, 8};
  EXPECT_FALSE(sfg_drawn_direction(engine, &direction));
  EXPECT_EQ(direction.azimuth, 7);
  float xy[2];
  EXPECT_EQ(sfg_project(engine, kPairPoints, 1, xy), 0u);
  EXPECT_TRUE(std::isnan(xy[0]));
  EXPECT_EQ(sfg_pick(engine, 0.5f, 0.5f), 0);
  ASSERT_TRUE(loadReserved(engine, writeFile("query.lodsplat", solidPairBytes()).c_str(), nullptr));
  ASSERT_TRUE(draw());
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  const float before = direction.azimuth;
  ASSERT_TRUE(sfg_orbit(engine, 0.2f, 0.1f));
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, before, kTolerance);
  ASSERT_TRUE(draw());
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, before + 0.2f, kTolerance);
}

TEST_F(SfgTest, PinchScaleDoublesProjectedSeparation) {
  ASSERT_TRUE(loadReserved(engine, writeFile("dolly.lodsplat", solidPairBytes()).c_str(), nullptr));
  ASSERT_TRUE(draw());
  const float points[] = {-0.1f, 0, 2, 0.1f, 0, 2};
  float before[4], after[4];
  ASSERT_EQ(sfg_project(engine, points, 2, before), 2u);
  ASSERT_TRUE(sfg_dolly(engine, 2));
  ASSERT_TRUE(draw());
  ASSERT_EQ(sfg_project(engine, points, 2, after), 2u);
  EXPECT_NEAR(after[2] - after[0], 2 * (before[2] - before[0]), kTolerance);
  EXPECT_FALSE(sfg_dolly(engine, 0));
  EXPECT_FALSE(sfg_dolly(engine, NAN));
  EXPECT_FALSE(sfg_dolly(engine, -1));
}

TEST_F(SfgTest, LimitsRejectInvalidInputAndNullRestoresFreeOrbit) {
  ASSERT_TRUE(loadReserved(engine, writeFile("limits.lodsplat", pairBytes()).c_str(), nullptr));
  draw();
  const sfg_camera_limits limits{-0.5f, 0.5f, -0.5f, 0.5f, 1, 10};
  ASSERT_TRUE(sfg_set_camera_limits(engine, &limits));
  for (const auto bad : {sfg_camera_limits{1, -1, 0, 1, 1, 10},
                         sfg_camera_limits{-4, 4, 0, 1, 1, 10},
                         sfg_camera_limits{-1, 1, 0, NAN, 1, 10}})
    EXPECT_FALSE(sfg_set_camera_limits(engine, &bad));
  ASSERT_TRUE(sfg_orbit(engine, 2, 2));
  draw();
  sfg_view_direction direction{};
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, 0.5f, kTolerance);
  EXPECT_NEAR(direction.elevation, 0.5f, kTolerance);
  ASSERT_TRUE(sfg_set_camera_limits(engine, nullptr));
  ASSERT_TRUE(sfg_orbit(engine, 1, 0));
  draw();
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, 1.5f, kTolerance);
}

TEST_F(SfgTest, FramesWithAndWithoutDirection) {
  ASSERT_TRUE(loadReserved(engine, writeFile("frame.lodsplat", pairBytes()).c_str(), nullptr));
  draw();
  const sfg_bounds bounds{{0, 0, 0}, {1, 1, 1}};
  const sfg_view_direction from{0.4f, 0.3f};
  ASSERT_TRUE(sfg_frame(engine, &bounds, 0.1f, &from));
  settle();
  sfg_view_direction direction{};
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, from.azimuth, kTolerance);
  EXPECT_NEAR(direction.elevation, from.elevation, kTolerance);
  const sfg_bounds other{{4, 0, 0}, {6, 2, 2}};
  ASSERT_TRUE(sfg_frame(engine, &other, 0, nullptr));
  draw();
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, from.azimuth, kTolerance);
  const float centre[] = {5, 1, 1};
  float xy[2];
  ASSERT_EQ(sfg_project(engine, centre, 1, xy), 1u);
  EXPECT_NEAR(xy[0], 0.5f, kTolerance);
  EXPECT_NEAR(xy[1], 0.5f, kTolerance);
  const sfg_bounds inverted{{1, 1, 1}, {0, 0, 0}};
  EXPECT_FALSE(sfg_frame(engine, &inverted, 0, nullptr));
}

TEST_F(SfgTest, ReadyWaitsForGpuCompletion) {
  renderer->gpuFinished = false;
  ASSERT_TRUE(loadReserved(engine, writeFile("delayed.lodsplat", pairBytes()).c_str(), nullptr));
  ASSERT_TRUE(draw());
  EXPECT_TRUE(events.empty());
  EXPECT_TRUE(sfg_needs_frame(engine));
  renderer->gpuFinished = true;
  draw();
  draw();  // Poll completion after the submitted frame.
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_WORLD_READY);
  EXPECT_EQ(events[0].count, kPairLeaves);
  EXPECT_FALSE(sfg_needs_frame(engine));
}

TEST_F(SfgTest, RejectsMalformedDigestsWithoutReportingSupersededRequests) {
  const auto path = writeFile("malformed.lodsplat", solidPairBytes());
  for (const char* bad : {"", "a", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}) {
    for (bool world : {true, false}) {
      const sfg_source_identity identity{world ? bad : kSolidPairSha256,
                                         world ? kPairLabelsSha256 : bad, kPairLeaves};
      const auto old = sfg_begin_load(engine);
      const auto current = sfg_begin_load(engine);
      events.clear();
      EXPECT_FALSE(sfg_load_request(engine, old, path.c_str(), nullptr, &identity));
      EXPECT_TRUE(events.empty());
      EXPECT_FALSE(sfg_load_request(engine, current, path.c_str(), nullptr, &identity));
      ASSERT_EQ(events.size(), 1u);
      EXPECT_EQ(events[0].kind, SFG_EVENT_LOAD_FAILED);
    }
  }
}

TEST_F(SfgTest, RevealUsesHostStyleAndZeroDisablesNextLoad) {
  sfg_set_reveal(engine, 1);
  const float points[] = {-1, -1, 2, 1, 1, 2};
  const auto path = writeFile("reveal.lodsplat", test::treeBytes(test::pairTree(points, 1, 0.5f)));
  ASSERT_TRUE(loadReserved(engine, path.c_str(), nullptr));
  ASSERT_TRUE(draw());
  EXPECT_FLOAT_EQ(renderer->last.reveal.tintAmount, 0.85f);
  EXPECT_FLOAT_EQ(renderer->last.reveal.brightnessBoost, 0.9f);
  EXPECT_FLOAT_EQ(renderer->last.reveal.tint[0], 10 / 255.0f);
  EXPECT_FLOAT_EQ(renderer->last.reveal.tint[1], 108 / 255.0f);
  EXPECT_FLOAT_EQ(renderer->last.reveal.tint[2], 1);
  EXPECT_GT(renderer->last.reveal.band, 0);
  settle();
  sfg_set_reveal(engine, 0);
  ASSERT_TRUE(loadReserved(engine, path.c_str(), nullptr));
  ASSERT_TRUE(draw());
  EXPECT_TRUE(std::isinf(renderer->last.reveal.level));
  draw();
  EXPECT_FALSE(sfg_needs_frame(engine));
}

TEST_F(SfgTest, CameraInputBeforeAWorldChangesNothing) {
  EXPECT_FALSE(sfg_orbit(engine, 0.1f, 0.1f));
  EXPECT_FALSE(sfg_dolly(engine, 2));
  ASSERT_TRUE(loadReserved(engine, writeFile("early.lodsplat", pairBytes()).c_str(), nullptr));
  draw();
  sfg_view_direction direction{7, 8};
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.azimuth, 0, kTolerance);
}
TEST_F(SfgTest, LimitsWiderThanTheEngineRangeNarrowToIt) {
  ASSERT_TRUE(loadReserved(engine, writeFile("wide.lodsplat", pairBytes()).c_str(), nullptr));
  draw();
  const sfg_camera_limits wide{-1, 1, -1.56f, 1.56f, 0.01f, 10};
  ASSERT_TRUE(sfg_set_camera_limits(engine, &wide));
  ASSERT_TRUE(sfg_orbit(engine, 0, 3));
  draw();
  sfg_view_direction direction{};
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(direction.elevation, kEngineMaxElevation, kTolerance);
  for (const auto bad : {sfg_camera_limits{-1, 1, 1.5f, 1.56f, 1, 10},
                         sfg_camera_limits{-1, 1, -1, 1.6f, 1, 10},
                         sfg_camera_limits{-1, 1, -1, 1, 0, 10},
                         sfg_camera_limits{-1, 1, -1, 1, 0.01f, 0.02f}})
    EXPECT_FALSE(sfg_set_camera_limits(engine, &bad));
}
TEST_F(SfgTest, WrapsLimitedOrbit) {
  // Equivalent angles must frame identically across the pi boundary.
  ASSERT_TRUE(loadReserved(engine, writeFile("wrapped.lodsplat", pairBytes()).c_str(), nullptr));
  draw();
  const sfg_camera_limits limits{2.5f, 3.5f, -1, 1, 0.05f, 10};
  ASSERT_TRUE(sfg_set_camera_limits(engine, &limits));
  const sfg_bounds bounds{{-1, -1, -1}, {1, 1, 1}};
  const sfg_view_direction from{-3, 0};
  ASSERT_TRUE(sfg_frame(engine, &bounds, 0, &from));
  draw();
  sfg_view_direction direction{};
  ASSERT_TRUE(sfg_drawn_direction(engine, &direction));
  EXPECT_NEAR(std::remainder(direction.azimuth + 3, 6.28318530717959f), 0, kTolerance);
}
}
}

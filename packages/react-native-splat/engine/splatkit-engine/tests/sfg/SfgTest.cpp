#include "splatkit/sfg.h"

#include <cmath>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include <gtest/gtest.h>

#include "FakeRenderer.h"
#include "TestWorlds.h"
#include "splatkit/sfg_platform.h"

namespace splatkit {
namespace {

using test::FakeRenderer;
using test::kPairPoints;
using test::labelBytes;
using test::pairBytes;
using test::solidPairBytes;

constexpr int64_t kVsyncNanos = 16666667;
constexpr float kTolerance = 1e-4f;

std::string writeFile(const std::string& name, const std::vector<uint8_t>& bytes) {
  const std::string path = ::testing::TempDir() + name;
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

// The C interface over a fake renderer, as a platform view holds it.
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
    while (sfg_needs_frame(engine)) draw();
  }

  FakeRenderer* renderer = nullptr;
  sfg_engine* engine = nullptr;
  std::vector<Event> events;
  int64_t vsync = 0;
};

TEST_F(SfgTest, LoadsAPackAndSaysWhenItIsOnScreen) {
  const std::string spz = writeFile("pair.spz", pairBytes());
  const std::string labels = writeFile("pair.labels.bin", labelBytes({1, 2}));
  ASSERT_TRUE(sfg_load(engine, spz.c_str(), labels.c_str()));
  EXPECT_TRUE(events.empty());
  EXPECT_TRUE(sfg_needs_frame(engine));
  EXPECT_TRUE(draw());
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_WORLD_READY);
  EXPECT_EQ(events[0].message, "");
  EXPECT_EQ(events[0].count, 2u);
  EXPECT_FALSE(sfg_needs_frame(engine));
}

TEST_F(SfgTest, ALoadWithoutLabelsIsAWorldWithNoParts) {
  const std::string spz = writeFile("solid.spz", solidPairBytes());
  ASSERT_TRUE(sfg_load(engine, spz.c_str(), nullptr));
  ASSERT_TRUE(draw());
  float at[4];
  ASSERT_EQ(sfg_project(engine, kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 0);
}

TEST_F(SfgTest, ReportsEachLoadFailureByItsKind) {
  const std::string spz = writeFile("pair.spz", pairBytes());
  const std::string labels = writeFile("three.labels.bin", labelBytes({1, 2, 3}));
  EXPECT_FALSE(sfg_load(engine, spz.c_str(), labels.c_str()));
  EXPECT_FALSE(sfg_load(engine, (::testing::TempDir() + "missing.spz").c_str(), nullptr));
  ASSERT_EQ(events.size(), 2u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_LABELS_MISMATCH);
  EXPECT_EQ(events[1].kind, SFG_EVENT_LOAD_FAILED);
  EXPECT_FALSE(events[1].message.empty());
}

TEST_F(SfgTest, ReportsAGpuFailure) {
  renderer->gpuFailed = true;
  draw();
  ASSERT_EQ(events.size(), 1u);
  EXPECT_EQ(events[0].kind, SFG_EVENT_GPU_FAILED);
}

TEST_F(SfgTest, PicksAndProjectsTheLastFrame) {
  const std::string spz = writeFile("solid.spz", solidPairBytes());
  const std::string labels = writeFile("solid.labels.bin", labelBytes({1, 2}));
  ASSERT_TRUE(sfg_load(engine, spz.c_str(), labels.c_str()));
  ASSERT_TRUE(draw());
  float at[4];
  ASSERT_EQ(sfg_project(engine, kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 1);
  EXPECT_EQ(sfg_pick(engine, at[2], at[3]), 2);
}

TEST_F(SfgTest, PlacesAndLimitsTheCamera) {
  sfg_camera_limits limits{-0.5f, 0.5f, 0.1f, 1.0f, 1.0f, 10.0f};
  ASSERT_TRUE(sfg_set_camera_limits(engine, &limits));
  const sfg_orbit_pose far{{1, 2, 3}, 50, 2, 0};
  ASSERT_TRUE(sfg_set_camera_pose(engine, &far));
  const sfg_orbit_pose pose = sfg_camera_pose(engine);
  EXPECT_EQ(pose.target.x, 1.0f);
  EXPECT_EQ(pose.target.z, 3.0f);
  EXPECT_EQ(pose.radius, 10.0f);
  EXPECT_EQ(pose.azimuth, 0.5f);
  EXPECT_EQ(pose.elevation, 0.1f);
  ASSERT_TRUE(sfg_orbit(engine, -0.25f, 0.2f));
  EXPECT_NEAR(sfg_camera_pose(engine).azimuth, 0.25f, kTolerance);
  ASSERT_TRUE(sfg_dolly(engine, 2));
  EXPECT_NEAR(sfg_camera_pose(engine).radius, 5, kTolerance);
  const sfg_camera_limits inverted{1, -1, 0, 1, 1, 10};
  EXPECT_FALSE(sfg_set_camera_limits(engine, &inverted));
  const sfg_orbit_pose bad{{0, 0, NAN}, 1, 0, 0};
  EXPECT_FALSE(sfg_set_camera_pose(engine, &bad));
}

TEST_F(SfgTest, NoLimitsTurnsFreelyAgain) {
  const sfg_camera_limits limits{-0.5f, 0.5f, 0.1f, 1.0f, 1.0f, 10.0f};
  ASSERT_TRUE(sfg_set_camera_limits(engine, &limits));
  ASSERT_TRUE(sfg_set_camera_limits(engine, nullptr));
  const sfg_orbit_pose behind{{0, 0, 0}, 50, 3, -0.5f};
  ASSERT_TRUE(sfg_set_camera_pose(engine, &behind));
  const sfg_orbit_pose pose = sfg_camera_pose(engine);
  EXPECT_EQ(pose.radius, 50.0f);
  EXPECT_EQ(pose.azimuth, 3.0f);
  EXPECT_EQ(pose.elevation, -0.5f);
}

TEST_F(SfgTest, FramesBoundsFromADirectionOrFromWhereItLooks) {
  const sfg_bounds part{{0, 0, 0}, {1, 1, 1}};
  const sfg_view_direction from{0.4f, 0.3f};
  ASSERT_TRUE(sfg_frame(engine, &part, 0.1f, &from));
  settle();
  sfg_orbit_pose pose = sfg_camera_pose(engine);
  EXPECT_NEAR(pose.azimuth, 0.4f, kTolerance);
  EXPECT_NEAR(pose.elevation, 0.3f, kTolerance);
  EXPECT_NEAR(pose.target.y, 0.5f, kTolerance);
  const sfg_bounds other{{4, 0, 0}, {6, 2, 2}};
  ASSERT_TRUE(sfg_frame(engine, &other, 0, nullptr));
  pose = sfg_camera_pose(engine);
  EXPECT_NEAR(pose.azimuth, 0.4f, kTolerance);
  EXPECT_NEAR(pose.target.x, 5, kTolerance);
  const sfg_bounds inverted{{1, 1, 1}, {0, 0, 0}};
  EXPECT_FALSE(sfg_frame(engine, &inverted, 0, nullptr));
}

TEST_F(SfgTest, HighlightsAndClearsParts) {
  const std::string spz = writeFile("pair.spz", pairBytes());
  const std::string labels = writeFile("pair.labels.bin", labelBytes({1, 0}));
  ASSERT_TRUE(sfg_load(engine, spz.c_str(), labels.c_str()));
  settle();
  const uint8_t part = 1;
  sfg_set_highlight(engine, &part, 1);
  settle();
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, Highlight::kTintAmount);
  sfg_set_highlight(engine, nullptr, 0);
  settle();
  EXPECT_EQ((*renderer->last.labelStyles)[1].tintAmount, 0.0f);
}

}  // namespace
}  // namespace splatkit

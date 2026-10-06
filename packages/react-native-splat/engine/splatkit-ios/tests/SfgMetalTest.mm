#include <gtest/gtest.h>

#import <QuartzCore/CAMetalLayer.h>

#include <chrono>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#include "TestWorlds.h"
#include "splatkit/sfg_metal.h"

namespace splatkit {
namespace {

constexpr int64_t kVsyncNanos = 16666667;
constexpr uint32_t kSide = 256;
// Vsyncs to wait for the GPU, a millisecond each, before calling the world lost.
constexpr int kMaxVsyncs = 5000;
constexpr auto kGpuPoll = std::chrono::milliseconds(1);

std::string writeFile(const std::string& name, const std::vector<uint8_t>& bytes) {
  const std::string path = ::testing::TempDir() + name;
  std::ofstream(path, std::ios::binary)
      .write(reinterpret_cast<const char*>(bytes.data()),
             static_cast<std::streamsize>(bytes.size()));
  return path;
}

class SfgMetalTest : public testing::Test {
 protected:
  void SetUp() override {
    engine = sfg_metal_create();
    if (engine == nullptr) GTEST_SKIP() << "Apple GPU family 7 unavailable";
    sfg_set_event_callback(
        engine,
        [](void* context, sfg_event kind, const char*, uint32_t) {
          static_cast<std::vector<sfg_event>*>(context)->push_back(kind);
        },
        &events);
    layer = [CAMetalLayer layer];
    layer.drawableSize = CGSizeMake(kSide, kSide);
    sfg_metal_set_layer(engine, layer);
    sfg_metal_set_drawable_size(engine, kSide, kSide);
  }
  void TearDown() override {
    if (engine == nullptr) return;
    sfg_metal_set_layer(engine, nil);
    sfg_destroy(engine);
  }

  void settle() {
    for (int i = 0; i < kMaxVsyncs && sfg_needs_frame(engine); ++i) {
      if (!sfg_draw(engine, ++vsync * kVsyncNanos)) std::this_thread::sleep_for(kGpuPoll);
    }
  }

  sfg_engine* engine = nullptr;
  CAMetalLayer* layer = nil;
  std::vector<sfg_event> events;
  int64_t vsync = 0;
};

TEST_F(SfgMetalTest, AWorldIsReadyOnceTheGpuHasDrawnItThenTheViewRests) {
  const std::string spz = writeFile("metal-solid.spz", test::solidPairBytes());
  const std::string labels = writeFile("metal-solid.labels.bin", test::labelBytes({1, 2}));
  ASSERT_TRUE(sfg_load(engine, spz.c_str(), labels.c_str()));
  settle();
  ASSERT_EQ(events, std::vector<sfg_event>{SFG_EVENT_WORLD_READY});
  EXPECT_FALSE(sfg_needs_frame(engine));
  float at[4];
  ASSERT_EQ(sfg_project(engine, test::kPairPoints, 2, at), 2u);
  EXPECT_EQ(sfg_pick(engine, at[0], at[1]), 1);
  EXPECT_EQ(sfg_pick(engine, at[2], at[3]), 2);
}

TEST_F(SfgMetalTest, WithoutALayerThereIsNothingToDo) {
  sfg_metal_set_layer(engine, nil);
  const std::string spz = writeFile("metal-pair.spz", test::pairBytes());
  ASSERT_TRUE(sfg_load(engine, spz.c_str(), nullptr));
  EXPECT_FALSE(sfg_needs_frame(engine));
  sfg_metal_set_layer(engine, layer);
  EXPECT_TRUE(sfg_needs_frame(engine));
  settle();
  EXPECT_EQ(events, std::vector<sfg_event>{SFG_EVENT_WORLD_READY});
}

}
}

#include <gtest/gtest.h>
#include "load-spz.h"
#include "splatkit/engine/SplatEngine.h"
#include "support/StubRenderer.h"
namespace splatkit {
TEST(Reveal, RisesAndRestoresIdle) {
  Reveal sweep;
  splat::Bounds bounds{{0, 0, 0}, {1, 10, 1}};
  RevealSettings settings;
  settings.seconds = 1;
  sweep.start(bounds, settings);
  EXPECT_LT(sweep.level(), 0);
  EXPECT_FLOAT_EQ(sweep.band(), 0.8f);
  float previous = sweep.level();
  for (int i = 0; i < 9; ++i) {
    EXPECT_TRUE(sweep.update(0.1f));
    EXPECT_GT(sweep.level(), previous);
    previous = sweep.level();
  }
  EXPECT_FALSE(sweep.update(-1));
  EXPECT_FALSE(sweep.update(std::numeric_limits<float>::quiet_NaN()));
  sweep.update(1);
  EXPECT_EQ(sweep.level(), std::numeric_limits<float>::infinity());
  EXPECT_EQ(sweep.band(), 0);
  EXPECT_FALSE(sweep.update(1));
  settings.seconds = 0;
  sweep.start(bounds, settings);
  EXPECT_FALSE(sweep.active());
  settings.seconds = 1;
  bounds.max[1] = 0;
  sweep.start(bounds, settings);
  EXPECT_FALSE(sweep.active());
}
TEST(Reveal, EngineAppliesSettingsOnLoadAndRedrawsUntilIdle) {
  class RecordingRenderer : public StubRenderer {
   public:
    RevealUniform reveal;
    bool draw(const Frame& frame) override {
      reveal = frame.reveal;
      return StubRenderer::draw(frame);
    }
  };
  spz::GaussianCloud cloud;
  cloud.numPoints = 2;
  cloud.positions = {0, 0, -2, 0, 10, -2};
  cloud.scales = {0, 0, 0, 0, 0, 0};
  cloud.rotations = {0, 0, 0, 1, 0, 0, 0, 1};
  cloud.alphas = {0, 0};
  cloud.colors = {0, 0, 0, 0, 0, 0};
  std::vector<uint8_t> bytes;
  ASSERT_TRUE(spz::saveSpz(cloud, spz::PackOptions{}, &bytes));
  for (const bool enabled : {false, true}) {
    auto renderer = std::make_unique<RecordingRenderer>();
    auto* observed = renderer.get();
    SplatEngine engine(std::move(renderer));
    engine.setSplatBudget(0);
    if (enabled) {
      RevealSettings settings;
      settings.seconds = 1;
      ASSERT_TRUE(engine.setReveal(settings));
    }
    engine.loadWorld(bytes.data(), bytes.size());
    engine.render(1);
    const float first = observed->reveal.level;
    engine.render(500000001);
    if (enabled)
      EXPECT_GT(observed->reveal.level, first);
    else
      EXPECT_EQ(first, std::numeric_limits<float>::infinity());
    engine.render(1500000001);
    EXPECT_EQ(observed->reveal.level, std::numeric_limits<float>::infinity());
    EXPECT_EQ(observed->reveal.band, 0);
    const auto frames = observed->frames;
    engine.render(1600000001);
    EXPECT_EQ(observed->frames, frames);
  }
}
}  // namespace splatkit

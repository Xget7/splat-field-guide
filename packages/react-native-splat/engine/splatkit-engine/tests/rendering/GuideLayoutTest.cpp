#include "splatkit/guide/GuideLayout.h"

#include <cstdint>
#include <vector>

#include <gtest/gtest.h>

namespace splatkit {
namespace {

constexpr float kRevealLevel = 1.5f;
constexpr float kRevealBand = 0.25f;
// Five labels fill one word and spill one byte into a second, padded with zeros.
constexpr uint32_t kFirstFourLabels = 0x04030201;
constexpr uint32_t kFifthLabelAlone = 0x00000005;
constexpr std::size_t kUnlabelledCount = 3;

splat::SplatCloud cloudOf(std::size_t count) {
  splat::SplatCloud cloud;
  cloud.positions.assign(count * 3, 0.0f);
  return cloud;
}

TEST(GuideLayout, PacksFiveLabelsIntoTwoWords) {
  splat::SplatCloud cloud = cloudOf(5);
  cloud.labels = {1, 2, 3, 4, 5};
  EXPECT_EQ(packLabels(cloud), (std::vector<uint32_t>{kFirstFourLabels, kFifthLabelAlone}));
}

TEST(GuideLayout, PacksZerosWithoutLabels) {
  EXPECT_EQ(packLabels(cloudOf(kUnlabelledCount)), std::vector<uint32_t>{0});
}

TEST(GuideLayout, GuideUniformIsIdentityWithoutStyles) {
  const GuideUniform guide = makeGuideUniform(nullptr, kRevealLevel, kRevealBand);
  for (const LabelStyle& style : guide.styles) {
    EXPECT_EQ(style.brightness, 1.0f);
    EXPECT_EQ(style.opacity, 1.0f);
    EXPECT_EQ(style.tintAmount, 0.0f);
  }
}

TEST(GuideLayout, GuideUniformCarriesTheReveal) {
  const GuideUniform guide = makeGuideUniform(nullptr, kRevealLevel, kRevealBand);
  EXPECT_EQ(guide.reveal[0], kRevealLevel);
  EXPECT_EQ(guide.reveal[1], kRevealBand);
}

}  // namespace
}  // namespace splatkit

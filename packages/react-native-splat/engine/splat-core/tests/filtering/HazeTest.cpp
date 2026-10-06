#include "splat/filtering/Haze.h"

#include <vector>

#include <gtest/gtest.h>

using splat::SplatCloud;

namespace {

constexpr float kTolerance = 1e-5f;
// Along one axis only, so the diagonal, and with it each share, is this many metres.
constexpr float kSceneSize = 48;
constexpr std::uint8_t kPart = 3;
constexpr std::uint8_t kBackground = 0;
constexpr std::size_t kHarmonics = 9;

void addSplat(SplatCloud& cloud, float sigma, std::uint8_t label, float id) {
  const float narrow = 0.01f;
  for (float p : {id, 0.0f, 0.0f}) cloud.positions.push_back(p);
  for (float c : {sigma * sigma, 0.0f, 0.0f, narrow, 0.0f, narrow}) cloud.covariances.push_back(c);
  for (int k = 0; k < 3; ++k) cloud.colors.push_back(id);
  cloud.alphas.push_back(id);
  for (std::size_t k = 0; k < kHarmonics; ++k) cloud.sh.push_back(id);
  cloud.labels.push_back(label);
}

}

TEST(Haze, WidestSigmaIsTheLargestAxisOfARotatedCovariance) {
  const float axisAligned[] = {4, 0, 0, 1, 0, 9};
  EXPECT_NEAR(splat::widestSigma(axisAligned), 3, kTolerance);
  // Variances 9 and 1 turned 45 degrees in the xy plane.
  const float turned[] = {5, 4, 0, 5, 0, 1};
  EXPECT_NEAR(splat::widestSigma(turned), 3, kTolerance);
}

TEST(Haze, RemovesWideSplatsAndWideBackgroundFromACaptureKeepingTheOrder) {
  SplatCloud cloud;
  cloud.bounds.max = {kSceneSize, 0, 0};
  const float part = kSceneSize * splat::kUnlabelledHazeShare * 1.2f;
  addSplat(cloud, 0.1f, kBackground, 1);
  addSplat(cloud, kSceneSize * splat::kHazeShare * 1.1f, kPart, 2);  // too wide for anything
  addSplat(cloud, part, kPart, 3);                                     // a part's own large splat
  addSplat(cloud, part, kBackground, 4);                               // the same as background
  addSplat(cloud, 0.1f, kPart, 5);
  SplatCloud sample = cloud;
  for (std::size_t i = cloud.count(); i < splat::kHazeMinSplats; ++i) {
    addSplat(cloud, 0.1f, kPart, 6);
  }
  const std::size_t kept = cloud.count() - 2;

  EXPECT_EQ(splat::removeHaze(sample), 0u);
  EXPECT_EQ(splat::removeHaze(cloud), 2u);
  EXPECT_EQ(std::vector<float>(cloud.alphas.begin(), cloud.alphas.begin() + 4),
            (std::vector<float>{1, 3, 5, 6}));
  EXPECT_EQ(std::vector<std::uint8_t>(cloud.labels.begin(), cloud.labels.begin() + 3),
            (std::vector<std::uint8_t>{kBackground, kPart, kPart}));
  EXPECT_EQ(cloud.alphas.size(), kept);
  EXPECT_EQ(cloud.positions.size(), kept * 3);
  EXPECT_EQ(cloud.covariances.size(), kept * 6);
  EXPECT_EQ(cloud.sh.size(), kept * kHarmonics);
  EXPECT_EQ(cloud.sh[kHarmonics], 3);
}

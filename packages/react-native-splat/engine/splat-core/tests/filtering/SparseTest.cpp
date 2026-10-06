#include "splat/filtering/Sparse.h"

#include <array>
#include <vector>

#include <gtest/gtest.h>

using splat::SplatCloud;

namespace {

constexpr std::uint8_t kPart = 3;
constexpr std::uint8_t kBackground = 0;
constexpr std::size_t kHarmonics = 9;
// Centimetre spacing keeps the block's corners dense enough to survive filtering.
constexpr int kBlockSide = 10;
constexpr float kBlockSpacing = 0.01f;
constexpr float kFaint = 0.3f;
// Far from the block in cells, so the floater has no neighbour in reach.
constexpr float kFloaterDistance = 1;
// So far that the grid at the usual cell size would be hundreds of gigabytes.
constexpr float kFarDistance = 1000;

void addSplat(SplatCloud& cloud, std::array<float, 3> position, float alpha, std::uint8_t label) {
  for (float p : position) cloud.positions.push_back(p);
  for (float c : {0.0001f, 0.0f, 0.0f, 0.0001f, 0.0f, 0.0001f}) cloud.covariances.push_back(c);
  for (int k = 0; k < 3; ++k) cloud.colors.push_back(alpha);
  cloud.alphas.push_back(alpha);
  for (std::size_t k = 0; k < kHarmonics; ++k) cloud.sh.push_back(alpha);
  cloud.labels.push_back(label);
}

SplatCloud blockWithFloater(float distance, std::uint8_t floaterLabel) {
  SplatCloud cloud;
  for (int ix = 0; ix < kBlockSide; ++ix) {
    for (int iy = 0; iy < kBlockSide; ++iy) {
      for (int iz = 0; iz < kBlockSide; ++iz) {
        addSplat(cloud, {ix * kBlockSpacing, iy * kBlockSpacing, iz * kBlockSpacing}, 1,
                 kBackground);
      }
    }
  }
  addSplat(cloud, {distance, 0, 0}, kFaint, floaterLabel);
  return cloud;
}

}

TEST(Sparse, RemovesAFaintFloaterAndKeepsTheBlockWithEveryArrayInStep) {
  SplatCloud cloud = blockWithFloater(kFloaterDistance, kBackground);
  const std::size_t kept = cloud.count() - 1;

  EXPECT_EQ(splat::removeSparse(cloud), 1u);
  EXPECT_EQ(cloud.count(), kept);
  EXPECT_EQ(cloud.alphas, std::vector<float>(kept, 1.0f));
  EXPECT_EQ(cloud.covariances.size(), kept * 6);
  EXPECT_EQ(cloud.colors.size(), kept * 3);
  EXPECT_EQ(cloud.sh.size(), kept * kHarmonics);
  EXPECT_EQ(cloud.labels.size(), kept);
}

TEST(Sparse, KeepsALabelledFloaterAndAUnlabelledCloudIsOpenToRemoval) {
  SplatCloud labelled = blockWithFloater(kFloaterDistance, kPart);
  const std::size_t count = labelled.count();
  EXPECT_EQ(splat::removeSparse(labelled), 0u);
  EXPECT_EQ(labelled.count(), count);

  SplatCloud unlabelled = blockWithFloater(kFloaterDistance, kBackground);
  unlabelled.labels.clear();
  EXPECT_EQ(splat::removeSparse(unlabelled), 1u);
}

TEST(Sparse, LeavesACloudTooSmallToJudgeAlone) {
  SplatCloud sample;
  for (std::size_t i = 0; i < 5; ++i) addSplat(sample, {static_cast<float>(i), 0, 0}, kFaint, kBackground);
  EXPECT_EQ(splat::removeSparse(sample), 0u);
  EXPECT_EQ(sample.count(), 5u);
}

TEST(Sparse, GrowsTheCellsRatherThanTheGridForAVeryLargeScene) {
  SplatCloud cloud = blockWithFloater(kFarDistance, kBackground);
  const std::size_t kept = cloud.count() - 1;
  EXPECT_EQ(splat::removeSparse(cloud), 1u);
  EXPECT_EQ(cloud.count(), kept);
}

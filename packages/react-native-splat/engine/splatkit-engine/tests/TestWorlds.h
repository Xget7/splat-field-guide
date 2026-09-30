#pragma once

#include <algorithm>
#include <cstdint>
#include <iterator>
#include <utility>
#include <vector>

#include <gtest/gtest.h>

#include "load-spz.h"
#include "splat/formats/PartLabels.h"

// Small worlds and their part labels, as the bytes of the files a pack holds.
namespace splatkit::test {

// Splats at `positions` (x, y, z each) in an SPZ file, one metre across and half opaque
// unless told otherwise.
inline std::vector<uint8_t> worldBytes(std::vector<float> positions, float logScale = 0,
                                       float alphaLogit = 0) {
  spz::GaussianCloud cloud;
  cloud.numPoints = static_cast<int>(positions.size() / 3);
  cloud.positions = std::move(positions);
  cloud.scales.assign(cloud.positions.size(), logScale);
  cloud.rotations.clear();
  for (int i = 0; i < cloud.numPoints; ++i)
    cloud.rotations.insert(cloud.rotations.end(), {0, 0, 0, 1});
  cloud.alphas.assign(static_cast<size_t>(cloud.numPoints), alphaLogit);
  cloud.colors.assign(cloud.positions.size(), 0);
  spz::PackOptions options;
  options.version = 2;
  std::vector<uint8_t> bytes;
  EXPECT_TRUE(spz::saveSpz(cloud, options, &bytes));
  return bytes;
}

// Two splats 2 m apart around (0, 0, 2).
inline std::vector<uint8_t> pairBytes() {
  return worldBytes({-1, 0, 2, 1, 0, 2});
}

// The same pair as small opaque splats, 5 cm across, that a tap can tell apart.
inline constexpr float kSmallLogScale = -3.0f;
inline constexpr float kOpaqueLogit = 5.0f;
inline constexpr float kPairPoints[] = {-1, 0, 2, 1, 0, 2};
inline std::vector<uint8_t> solidPairBytes() {
  return worldBytes({std::begin(kPairPoints), std::end(kPairPoints)}, kSmallLogScale, kOpaqueLogit);
}

// A labels.bin giving these labels to the splats in order.
inline std::vector<uint8_t> labelBytes(const std::vector<uint8_t>& labels) {
  std::vector<uint8_t> bytes(splat::part_labels::kHeaderBytes, 0);
  std::copy(std::begin(splat::part_labels::kMagic), std::end(splat::part_labels::kMagic),
            bytes.begin());
  bytes[4] = splat::part_labels::kVersion;
  bytes[6] = splat::part_labels::kBytesPerLabel;
  bytes[8] = static_cast<uint8_t>(labels.size());
  bytes.insert(bytes.end(), labels.begin(), labels.end());
  return bytes;
}

}  // namespace splatkit::test

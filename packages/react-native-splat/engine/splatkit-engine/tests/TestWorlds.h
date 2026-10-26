#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include <gtest/gtest.h>

#include "splat/formats/PartLabels.h"
#include "splat/lod/LodFile.h"

namespace splatkit::test {

// Two leaf splats under one merged root, the smallest tree a pack ships. It is written by hand,
// not by buildLodTree, so its bytes and digest are the same with every platform's maths library.
inline splat::LodTree pairTree(const float* points, float sigma, float alpha) {
  constexpr uint32_t kNodes = 3;
  const float variance = sigma * sigma;
  float half[3];
  float centre[3];
  for (int k = 0; k < 3; ++k) {
    half[k] = (points[3 + k] - points[k]) / 2;
    centre[k] = points[k] + half[k];
  }
  splat::LodTree tree;
  splat::SplatCloud& c = tree.nodes;
  // The root matches the pair's spatial moments: their variance plus the spread of the centres.
  c.positions.assign(centre, centre + 3);
  c.covariances = {variance + half[0] * half[0], half[0] * half[1], half[0] * half[2],
                   variance + half[1] * half[1], half[1] * half[2], variance + half[2] * half[2]};
  c.positions.insert(c.positions.end(), points, points + 6);
  for (int leaf = 0; leaf < 2; ++leaf)
    c.covariances.insert(c.covariances.end(), {variance, 0, 0, variance, 0, variance});
  c.colors.assign(kNodes * 3, 0);
  c.alphas.assign(kNodes, alpha);
  for (int k = 0; k < 3; ++k) {
    c.bounds.min[k] = std::min(points[k], points[3 + k]);
    c.bounds.max[k] = std::max(points[k], points[3 + k]);
  }
  const float spread = half[0] * half[0] + half[1] * half[1] + half[2] * half[2];
  tree.layout.assign(kNodes, splat::LodNode{});
  tree.layout[0] = {{centre[0], centre[1], centre[2]}, 2 * std::sqrt(variance + spread), 1, 2};
  for (uint32_t leaf = 1; leaf < kNodes; ++leaf) {
    const float* p = &c.positions[leaf * 3];
    tree.layout[leaf] = {{p[0], p[1], p[2]}, 2 * sigma, kNodes, 0};
  }
  tree.leafCount = 2;
  return tree;
}

// The .lodsplat bytes of a tree.
inline std::vector<uint8_t> treeBytes(const splat::LodTree& tree) {
  // writeLodSplat never replaces a file.
  const std::string path = ::testing::TempDir() + "test-world.lodsplat";
  std::remove(path.c_str());
  EXPECT_TRUE(splat::writeLodSplat(tree, path).ok());
  std::ifstream in(path, std::ios::binary);
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)),
                             std::istreambuf_iterator<char>());
  std::remove(path.c_str());
  return bytes;
}

// Default test splats are one metre across and half opaque.
inline constexpr float kPairPoints[] = {-1, 0, 2, 1, 0, 2};
inline constexpr float kWideSigma = 1;
inline constexpr float kHalfOpaque = 0.5f;
inline std::vector<uint8_t> pairBytes() {
  return treeBytes(pairTree(kPairPoints, kWideSigma, kHalfOpaque));
}

// Five-centimetre opaque splats keep the pair distinguishable by picking.
inline constexpr float kSmallSigma = 0.05f;
inline constexpr float kOpaque = 0.99f;
inline std::vector<uint8_t> solidPairBytes() {
  return treeBytes(pairTree(kPairPoints, kSmallSigma, kOpaque));
}

// A labels file in node order: for a pair, the root's label and then each leaf's.
inline std::vector<uint8_t> labelBytes(const std::vector<uint8_t>& labels) {
  return splat::encodePartLabels(labels);
}

}  // namespace splatkit::test

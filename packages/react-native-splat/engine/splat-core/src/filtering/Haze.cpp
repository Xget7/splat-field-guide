#include "splat/filtering/Haze.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "splat/filtering/Compaction.h"

namespace splat {

float widestSigma(const float* c) {
  // The largest eigenvalue of a symmetric 3x3 matrix, in closed form (Smith, 1961).
  const double xx = c[0], xy = c[1], xz = c[2], yy = c[3], yz = c[4], zz = c[5];
  const double offDiagonal = xy * xy + xz * xz + yz * yz;
  double largest;
  if (offDiagonal == 0) {
    largest = std::max({xx, yy, zz});
  } else {
    const double mean = (xx + yy + zz) / 3;
    const double ax = xx - mean, ay = yy - mean, az = zz - mean;
    const double spread = std::sqrt((ax * ax + ay * ay + az * az + 2 * offDiagonal) / 6);
    const double halfDeterminant = (ax * (ay * az - yz * yz) - xy * (xy * az - yz * xz) +
                                    xz * (xy * yz - ay * xz)) /
                                   (2 * spread * spread * spread);
    const double angle = std::acos(std::clamp(halfDeterminant, -1.0, 1.0)) / 3;
    largest = mean + 2 * spread * std::cos(angle);
  }
  return static_cast<float>(std::sqrt(std::max(largest, 0.0)));
}

std::size_t removeHaze(SplatCloud& cloud) {
  const std::size_t n = cloud.count();
  if (n < kHazeMinSplats) return 0;
  float squared = 0;
  for (int k = 0; k < 3; ++k) {
    const float extent = cloud.bounds.max[k] - cloud.bounds.min[k];
    squared += extent * extent;
  }
  const float diagonal = std::sqrt(squared);
  if (!(diagonal > 0)) return 0;
  const bool labelled = !cloud.labels.empty();
  std::vector<bool> keep(n);
  std::size_t removed = 0;
  for (std::size_t i = 0; i < n; ++i) {
    const float share = widestSigma(&cloud.covariances[i * 6]) / diagonal;
    const bool background = labelled && cloud.labels[i] == 0;
    keep[i] = share <= kHazeShare && !(background && share > kUnlabelledHazeShare);
    removed += keep[i] ? 0 : 1;
  }
  if (removed == 0) return 0;
  keepSplats(cloud, keep);
  return removed;
}

}  // namespace splat

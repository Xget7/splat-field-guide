#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace splat {

struct Bounds {
  std::array<float, 3> min{0, 0, 0};
  std::array<float, 3> max{0, 0, 0};
};

// Renderers consume decoded RUB attributes in per-splat arrays without depending on the file
// format.
struct SplatCloud {
  // xyz per splat, in meters.
  std::vector<float> positions;
  // Covariance stores R * S * S^T * R^T as xx, xy, xz, yy, yz, zz.
  std::vector<float> covariances;
  // rgb per splat in [0, 1], sRGB encoded as the training data was.
  std::vector<float> colors;
  // Opacity per splat, sigmoid already applied, in [0, 1].
  std::vector<float> alphas;
  int shDegree = 0;
  // Higher order SH coefficients, (numCoefficients * 3) per splat, empty for degree 0.
  std::vector<float> sh;
  // Part label per splat, 0 for none; empty when the cloud came without labels.
  std::vector<std::uint8_t> labels;
  Bounds bounds;

  std::size_t count() const { return positions.size() / 3; }
};

}

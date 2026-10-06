#pragma once

#include <cstddef>

#include "splat/formats/SplatCloud.h"

namespace splat {

// Treat a splat as haze when its widest standard deviation exceeds this fraction of the scene
// diagonal, keeping the threshold scale-independent.
inline constexpr float kHazeShare = 1.0f / 48;
// Unlabelled splats use a tighter width threshold so large part splats survive.
inline constexpr float kUnlabelledHazeShare = 1.0f / 80;
// Small samples do not span the scene reliably enough to infer haze.
inline constexpr std::size_t kHazeMinSplats = 1000;

// The widest standard deviation of a covariance given as xx, xy, xz, yy, yz, zz.
float widestSigma(const float* covariance);

// Preserve survivor order and the enclosing bounds.
std::size_t removeHaze(SplatCloud& cloud);

}

#pragma once

#include <cstddef>

#include "splat/formats/SplatCloud.h"

namespace splat {

// Training leaves Gaussians that grew wide to explain what no camera saw well: the smoky
// haze and streaks around a capture. Real surfaces are built from small splats, so a
// splat wider than a share of the whole scene is taken for haze. Shares, not metres, so
// the rule holds at any scale.
//
// Any splat whose widest standard deviation passes this share of the scene's diagonal.
inline constexpr float kHazeShare = 1.0f / 48;
// In a labelled cloud, the unlabelled splats around the parts pass for haze at a smaller
// width: a part's own large splats are kept, the background's are not.
inline constexpr float kUnlabelledHazeShare = 1.0f / 80;
// Fewer splats than this are a sample rather than a capture: too few to span the scene,
// so their size says nothing about haze, and they are left alone.
inline constexpr std::size_t kHazeMinSplats = 1000;

// The widest standard deviation of a covariance given as xx, xy, xz, yy, yz, zz.
float widestSigma(const float* covariance);

// Removes the haze from `cloud`, keeping the order of what remains; returns how many
// splats it removed. The bounds are left as they were, so they still enclose the cloud.
std::size_t removeHaze(SplatCloud& cloud);

}  // namespace splat

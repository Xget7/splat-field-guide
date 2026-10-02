#pragma once

#include <cstddef>

#include "splat/formats/SplatCloud.h"

namespace splat {

// Training also leaves faint floaters: semi-transparent splats hanging in empty space,
// away from any surface. A real surface packs a lot of opacity into a small volume, a
// floater is nearly alone, so the opacity found around a splat tells the two apart.
//
// Opacity is summed in a grid of cells this wide, in metres.
inline constexpr float kSparseCell = 0.02f;
// A splat is a floater when the opacity in its cell and the 26 around it adds up to less
// than this: about ten fully opaque splats, a few more when they are faint.
inline constexpr float kSparseAlpha = 10.0f;
// Fewer splats than this are a sample rather than a capture, and are left alone, as the
// haze filter does.
inline constexpr std::size_t kSparseMinSplats = 1000;
// The most cells the grid may have. A capture spread over a very large volume would need
// more than that at kSparseCell, so the cells grow instead: 16M floats is 64 MB, the most
// a phone should spend on a load-time filter.
inline constexpr std::size_t kSparseMaxCells = std::size_t{1} << 24;

// Removes the floaters from `cloud`, keeping the order of what remains; returns how many
// splats it removed. Splats of a named part are always kept, and so are all of them in a
// cloud too small to judge. The bounds are left as they were, so they still enclose the
// cloud.
std::size_t removeSparse(SplatCloud& cloud);

}  // namespace splat

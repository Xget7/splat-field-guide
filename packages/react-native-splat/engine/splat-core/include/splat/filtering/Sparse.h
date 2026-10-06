#pragma once

#include <cstddef>

#include "splat/formats/SplatCloud.h"

namespace splat {

// Sum opacity in cells this wide, in metres, to distinguish dense surfaces from isolated floaters.
inline constexpr float kSparseCell = 0.02f;
// The cell and its 26 neighbours must contain this much opacity to preserve an unlabelled splat.
inline constexpr float kSparseAlpha = 10.0f;
// Small samples lack enough neighbours for reliable filtering.
inline constexpr std::size_t kSparseMinSplats = 1000;
// Grow cells beyond this grid size to cap load-time filtering at 64 MB.
inline constexpr std::size_t kSparseMaxCells = std::size_t{1} << 24;

// Preserve labelled splats, small clouds, survivor order and the enclosing bounds.
std::size_t removeSparse(SplatCloud& cloud);

}

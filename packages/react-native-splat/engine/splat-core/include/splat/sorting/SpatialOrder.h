#pragma once

#include <cstdint>
#include <vector>

#include "splat/formats/SplatCloud.h"

namespace splat {

// Morton ordering keeps nearby splats together in memory to improve GPU access after distance
// sorting.
// Every attribute array is permuted together, part labels included; bounds and SH
// degree are unchanged.
void reorderSpatially(SplatCloud& cloud);

// 30 bit Morton code of a point quantised to 1024 cells per axis inside the bounds.
std::uint32_t mortonCode(const float* position, const Bounds& bounds);

}

#pragma once

#include <vector>

#include "splat/formats/SplatCloud.h"

namespace splat {

// keep has one entry per splat; compaction preserves survivor order across every attribute and
// leaves the enclosing bounds unchanged.
void keepSplats(SplatCloud& cloud, const std::vector<bool>& keep);

}

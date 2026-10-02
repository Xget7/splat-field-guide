#pragma once

#include <vector>

#include "splat/formats/SplatCloud.h"

namespace splat {

// Drops every splat whose entry in `keep` is false, from every per-splat array, keeping
// the order of the rest. `keep` holds one entry per splat. The bounds are left as they
// were, so they still enclose the cloud.
void keepSplats(SplatCloud& cloud, const std::vector<bool>& keep);

}  // namespace splat

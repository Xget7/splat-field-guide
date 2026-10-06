#pragma once

#include <cstddef>
#include <cstdint>

#include "splat/core/CoordinateFrame.h"
#include "splat/core/Result.h"
#include "splat/formats/SplatCloud.h"

namespace splat {

struct SpzDecodeOptions {
  // Frame the file was written in. World Labs does not tag it, so the caller declares it.
  CoordinateFrame sourceFrame = kWorldLabsFrame;
  // Limit runtime SH allocation without changing the source file.
  int maxShDegree = 3;
  // Bound decompressed bytes to reject oversized NGSP headers and stop gzip inflation before
  // excessive allocation.
  std::size_t maxDecodedBytes = 768u * 1024u * 1024u;
};

// Decode SPZ v1-v4 into RUB, returning unsupportedFormat for unknown containers or corrupt for
// broken, truncated or oversized payloads.
Result<SplatCloud> decodeSpz(const std::uint8_t* data, std::size_t size,
                             const SpzDecodeOptions& options = {});

}

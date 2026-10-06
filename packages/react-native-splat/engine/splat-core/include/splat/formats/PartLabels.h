#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "splat/core/Result.h"

namespace splat {

// labels.bin has a 16-byte little-endian header (magic, u16 version, u16 label width, u32 splat
// count, u32 reserved zero), then one byte per SPZ splat.
namespace part_labels {
constexpr std::uint8_t kMagic[4] = {'S', 'F', 'G', 'L'};
constexpr std::uint16_t kVersion = 1;
constexpr std::uint16_t kBytesPerLabel = 1;
constexpr std::size_t kHeaderBytes = 16;
}

// Invalid magic, version or width is unsupportedFormat; a count/size disagreement is corrupt.
Result<std::vector<std::uint8_t>> decodePartLabels(const std::uint8_t* data, std::size_t size);

}

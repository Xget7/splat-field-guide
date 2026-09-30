#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "splat/core/Result.h"

namespace splat {

// labels.bin: the part label of every splat of one cloud, in the cloud's SPZ order. A
// 16-byte little-endian header (magic, u16 version, u16 bytes per label, u32 splat count,
// u32 reserved zero), then one byte per splat.
namespace part_labels {
constexpr std::uint8_t kMagic[4] = {'S', 'F', 'G', 'L'};
constexpr std::uint16_t kVersion = 1;
constexpr std::uint16_t kBytesPerLabel = 1;
constexpr std::size_t kHeaderBytes = 16;
}  // namespace part_labels

// The labels of a labels.bin, one per splat. Fails as `unsupportedFormat` for another
// magic, version or label width, and as `corrupt` when the size disagrees with the count.
Result<std::vector<std::uint8_t>> decodePartLabels(const std::uint8_t* data, std::size_t size);

}  // namespace splat

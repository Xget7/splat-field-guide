#include "splat/formats/PartLabels.h"

#include <cstring>
#include <string>

namespace splat {
namespace {

constexpr std::size_t kVersionOffset = 4;
constexpr std::size_t kWidthOffset = 6;
constexpr std::size_t kCountOffset = 8;
constexpr std::size_t kReservedOffset = 12;

std::uint16_t readU16(const std::uint8_t* p) {
  return static_cast<std::uint16_t>(p[0] | (p[1] << 8));
}

std::uint32_t readU32(const std::uint8_t* p) {
  return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
         (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
}

}

Result<std::vector<std::uint8_t>> decodePartLabels(const std::uint8_t* data, std::size_t size) {
  using namespace part_labels;
  if (data == nullptr || size < kHeaderBytes ||
      std::memcmp(data, kMagic, sizeof(kMagic)) != 0) {
    return Error{ErrorCode::unsupportedFormat, "not a part labels file"};
  }
  const std::uint16_t version = readU16(data + kVersionOffset);
  const std::uint16_t width = readU16(data + kWidthOffset);
  if (version != kVersion || width != kBytesPerLabel) {
    return Error{ErrorCode::unsupportedFormat,
                 "part labels version " + std::to_string(version) + " with " +
                     std::to_string(width) + " bytes per label"};
  }
  const std::uint32_t count = readU32(data + kCountOffset);
  if (readU32(data + kReservedOffset) != 0 || size - kHeaderBytes != count) {
    return Error{ErrorCode::corrupt, "part labels file of " + std::to_string(size) +
                                         " bytes for " + std::to_string(count) + " labels"};
  }
  return std::vector<std::uint8_t>(data + kHeaderBytes, data + size);
}

}

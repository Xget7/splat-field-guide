#pragma once

#include <cstdint>

namespace splatkit {

// Width of the depth keys the visibility pass writes and the radix sort orders.
enum class KeyBits : uint32_t { full32, low16 };

inline constexpr uint32_t kFullKeyBits = 32;
inline constexpr uint32_t kLowKeyBits = 16;

constexpr uint32_t keyBitCount(KeyBits bits) {
  return bits == KeyBits::low16 ? kLowKeyBits : kFullKeyBits;
}

}  // namespace splatkit

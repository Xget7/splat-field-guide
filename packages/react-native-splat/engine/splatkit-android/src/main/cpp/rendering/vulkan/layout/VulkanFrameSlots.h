#pragma once

#include <cstdint>

namespace splatkit {

// Frames the CPU records while the GPU still draws earlier ones.
inline constexpr uint32_t kFramesInFlight = 2;

}  // namespace splatkit

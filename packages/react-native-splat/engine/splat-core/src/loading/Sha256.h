#pragma once

#include <array>
#include <cstdint>

#include "splat/loading/SplatWorldLoader.h"

namespace splat::detail {

using Sha256Digest = std::array<std::uint8_t, 32>;
Result<std::string> sha256(ByteView bytes, bool allowHardware = true);
Sha256Digest sha256Portable(ByteView bytes);
bool armSha256Available();
Sha256Digest sha256Arm(ByteView bytes);

}

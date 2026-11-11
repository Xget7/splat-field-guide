#pragma once

#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {

// The build selects the same layout for upload, descriptor bounds and GLSL decoding.
#if SPLATKIT_VULKAN_SH8
inline constexpr ShStorage kVulkanShStorage = ShStorage::scaled8;
#else
inline constexpr ShStorage kVulkanShStorage = ShStorage::float16;
#endif

}  // namespace splatkit

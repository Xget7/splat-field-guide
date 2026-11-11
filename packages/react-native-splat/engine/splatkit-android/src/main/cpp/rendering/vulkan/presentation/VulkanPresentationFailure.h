#pragma once
#include <vulkan/vulkan_core.h>

namespace splatkit {
// Presentation can fail while the device remains usable after a surface replacement.
inline bool terminalPresentationFailure(VkResult result) {
  return result == VK_ERROR_DEVICE_LOST;
}
}  // namespace splatkit

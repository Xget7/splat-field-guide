#pragma once

#include <vulkan/vulkan.h>

namespace splatkit {

// One global memory barrier; the passes order whole buffers, never single ranges.
inline void vulkanMemoryBarrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage,
                                VkAccessFlags srcAccess, VkPipelineStageFlags dstStage,
                                VkAccessFlags dstAccess) {
  VkMemoryBarrier barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
  barrier.srcAccessMask = srcAccess;
  barrier.dstAccessMask = dstAccess;
  vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 1, &barrier, 0, nullptr, 0, nullptr);
}

}  // namespace splatkit

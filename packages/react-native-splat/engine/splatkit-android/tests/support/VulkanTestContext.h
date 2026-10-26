#pragma once

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <vector>

#include "rendering/vulkan/device/VulkanBuffer.h"

namespace splatkit::test {

inline void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

// No surface, Android activity, or renderer. Own this before all GPU resources.
// Calls are single-threaded; submit waits for completion before returning.
// Set SPLATKIT_REQUIRE_VALIDATION=1 to fail if the loader cannot discover the layer.
class VulkanTestContext {
 public:
  VulkanTestContext() {
    auto result = VulkanContext::create();
    if (!result) throw std::runtime_error(result.error().message);
    context = std::move(result.value());
    if (const char* required = std::getenv("SPLATKIT_REQUIRE_VALIDATION")) {
      if (std::strcmp(required, "1") == 0)
        require(context->validationEnabled(), "required Vulkan validation layer unavailable");
    }
  }

  void requireValidationClean() const {
    require(context->validationMessageCount() == 0, "Vulkan validation warning/error");
  }

  // True where some memory is both the GPU's own and mappable, as on phones.
  bool sharesDeviceMemory() const {
    VkPhysicalDeviceMemoryProperties memory{};
    vkGetPhysicalDeviceMemoryProperties(context->physicalDevice(), &memory);
    constexpr VkMemoryPropertyFlags kShared =
        VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT | VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT;
    for (uint32_t i = 0; i < memory.memoryTypeCount; ++i) {
      if ((memory.memoryTypes[i].propertyFlags & kShared) == kShared) return true;
    }
    return false;
  }

  // Some memory type `buffer` may live in is device local, host visible and coherent.
  bool offersSharedCoherent(VkBuffer buffer) const {
    VkMemoryRequirements requirements{};
    vkGetBufferMemoryRequirements(context->device(), buffer, &requirements);
    VkPhysicalDeviceMemoryProperties memory{};
    vkGetPhysicalDeviceMemoryProperties(context->physicalDevice(), &memory);
    constexpr VkMemoryPropertyFlags kSharedCoherent = VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT |
                                                      VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT |
                                                      VK_MEMORY_PROPERTY_HOST_COHERENT_BIT;
    for (uint32_t i = 0; i < memory.memoryTypeCount; ++i) {
      if ((requirements.memoryTypeBits & (1u << i)) &&
          (memory.memoryTypes[i].propertyFlags & kSharedCoherent) == kSharedCoherent)
        return true;
    }
    return false;
  }

  void submit(const std::function<void(VkCommandBuffer)>& record) const {
    struct Commands {
      explicit Commands(VkDevice device) : device(device) {}
      Commands(const Commands&) = delete;
      Commands& operator=(const Commands&) = delete;
      VkDevice device;
      VkCommandPool pool = VK_NULL_HANDLE;
      VkFence fence = VK_NULL_HANDLE;
      ~Commands() {
        if (fence) vkDestroyFence(device, fence, nullptr);
        if (pool) vkDestroyCommandPool(device, pool, nullptr);
      }
    } commands{context->device()};
    VkCommandPoolCreateInfo pool{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    pool.queueFamilyIndex = context->queueFamily();
    pool.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    require(vkCreateCommandPool(commands.device, &pool, nullptr, &commands.pool) == VK_SUCCESS,
            "create command pool");
    VkCommandBufferAllocateInfo allocate{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    allocate.commandPool = commands.pool;
    allocate.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocate.commandBufferCount = 1;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    require(vkAllocateCommandBuffers(commands.device, &allocate, &cmd) == VK_SUCCESS,
            "allocate command buffer");
    VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
    begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    require(vkBeginCommandBuffer(cmd, &begin) == VK_SUCCESS, "begin command buffer");
    record(cmd);
    require(vkEndCommandBuffer(cmd) == VK_SUCCESS, "end command buffer");
    const VkFenceCreateInfo fence{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    require(vkCreateFence(commands.device, &fence, nullptr, &commands.fence) == VK_SUCCESS,
            "create fence");
    VkSubmitInfo info{VK_STRUCTURE_TYPE_SUBMIT_INFO};
    info.commandBufferCount = 1;
    info.pCommandBuffers = &cmd;
    require(vkQueueSubmit(context->queue(), 1, &info, commands.fence) == VK_SUCCESS, "submit");
    require(vkWaitForFences(commands.device, 1, &commands.fence, VK_TRUE, UINT64_MAX) == VK_SUCCESS,
            "wait for GPU");
  }

  // Source must have TRANSFER_SRC usage. Makes prior GPU writes visible, copies,
  // waits, then invalidates noncoherent memory before returning the actual bytes.
  std::vector<uint8_t> readback(const VulkanBuffer& source, VkDeviceSize bytes) const {
    require(bytes > 0 && bytes <= source.size(), "readback range");
    auto destination = VulkanBuffer::hostVisible(
        *context, std::min<VkDeviceSize>(bytes, 2 * 1024 * 1024), VK_BUFFER_USAGE_TRANSFER_DST_BIT);
    require(destination && destination->mapped(), "create readback buffer");
    std::vector<uint8_t> result(static_cast<size_t>(bytes));
    for (VkDeviceSize copied = 0; copied < bytes;) {
      const VkDeviceSize chunk = std::min(destination->size(), bytes - copied);
      submit([&](VkCommandBuffer cmd) {
        VkMemoryBarrier before{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        before.srcAccessMask = VK_ACCESS_MEMORY_WRITE_BIT;
        before.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT,
                             VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 1, &before, 0, nullptr, 0, nullptr);
        const VkBufferCopy region{copied, 0, chunk};
        vkCmdCopyBuffer(cmd, source.handle(), destination->handle(), 1, &region);
        VkMemoryBarrier after{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
        after.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        after.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 1,
                             &after, 0, nullptr, 0, nullptr);
      });
      destination->invalidate(0, chunk);
      std::memcpy(result.data() + copied, destination->mapped(), static_cast<size_t>(chunk));
      copied += chunk;
    }
    return result;
  }

  std::unique_ptr<VulkanContext> context;
};

}  // namespace splatkit::test

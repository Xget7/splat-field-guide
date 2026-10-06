#include "rendering/vulkan/GpuBuffer.h"

#include <algorithm>
#include <cstring>

#include "splatkit/Log.h"

namespace splatkit {
namespace {

bool create(const VulkanContext& ctx, VkDeviceSize size, VkBufferUsageFlags usage,
            VmaAllocationCreateFlags flags, bool map, VkBuffer& buffer, VmaAllocation& allocation,
            void*& mapped) {
  if (size == 0) return false;
  VkBufferCreateInfo info{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
  info.size = size;
  info.usage = usage;
  info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

  VmaAllocationCreateInfo alloc{};
  alloc.usage = VMA_MEMORY_USAGE_AUTO;
  alloc.flags = flags | (map ? VMA_ALLOCATION_CREATE_MAPPED_BIT : 0);

  VmaAllocationInfo result{};
  if (vmaCreateBuffer(ctx.allocator(), &info, &alloc, &buffer, &allocation, &result) !=
      VK_SUCCESS) {
    LOGE("vmaCreateBuffer failed for %llu bytes", static_cast<unsigned long long>(size));
    return false;
  }
  mapped = map ? result.pMappedData : nullptr;
  if (map && !mapped) {
    vmaDestroyBuffer(ctx.allocator(), buffer, allocation);
    buffer = VK_NULL_HANDLE;
    allocation = VK_NULL_HANDLE;
    return false;
  }
  return true;
}

}  // namespace

std::unique_ptr<GpuBuffer> GpuBuffer::deviceLocal(const VulkanContext& ctx, VkDeviceSize size,
                                                  VkBufferUsageFlags usage) {
  std::unique_ptr<GpuBuffer> b(new GpuBuffer(ctx));
  b->size_ = size;
  create(ctx, size, usage | VK_BUFFER_USAGE_TRANSFER_DST_BIT, 0, false, b->buffer_, b->allocation_,
         b->mapped_);
  return b->buffer_ != VK_NULL_HANDLE ? std::move(b) : nullptr;
}

std::unique_ptr<GpuBuffer> GpuBuffer::hostVisible(const VulkanContext& ctx, VkDeviceSize size,
                                                  VkBufferUsageFlags usage) {
  std::unique_ptr<GpuBuffer> b(new GpuBuffer(ctx));
  b->size_ = size;
  create(ctx, size, usage, VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT, true, b->buffer_,
         b->allocation_, b->mapped_);
  return b->buffer_ != VK_NULL_HANDLE ? std::move(b) : nullptr;
}

GpuBuffer::~GpuBuffer() {
  if (buffer_ != VK_NULL_HANDLE) vmaDestroyBuffer(ctx_.allocator(), buffer_, allocation_);
}

void GpuBuffer::flush(VkDeviceSize offset, VkDeviceSize size) const {
  vmaFlushAllocation(ctx_.allocator(), allocation_, offset, size);
}

void GpuBuffer::invalidate(VkDeviceSize offset, VkDeviceSize size) const {
  vmaInvalidateAllocation(ctx_.allocator(), allocation_, offset, size);
}

bool GpuBuffer::upload(VkDeviceSize offset, const void* data, VkDeviceSize size) {
  if (offset > size_ || size > size_ - offset) return false;
  if (size == 0) return true;
  if (!data || size > SIZE_MAX) return false;
  // Bound transient mapped memory independently of the world size. Reuse the
  // staging bytes only after each copy's fence, including the final partial window.
  constexpr VkDeviceSize kStagingBytes = 2 * 1024 * 1024;
  auto staging = hostVisible(ctx_, std::min(size, kStagingBytes), VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
  if (!staging) return false;

  VkDevice device = ctx_.device();
  VkCommandPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
  poolInfo.queueFamilyIndex = ctx_.queueFamily();
  poolInfo.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
  VkCommandPool pool = VK_NULL_HANDLE;
  if (vkCreateCommandPool(device, &poolInfo, nullptr, &pool) != VK_SUCCESS) return false;

  VkCommandBufferAllocateInfo cmdInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
  cmdInfo.commandPool = pool;
  cmdInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  cmdInfo.commandBufferCount = 1;
  VkCommandBuffer cmd = VK_NULL_HANDLE;
  VkFence fence = VK_NULL_HANDLE;
  const VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
  VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
  begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
  submit.commandBufferCount = 1;
  submit.pCommandBuffers = &cmd;
  // Each step can fail under memory pressure, which is when a 2M splat upload runs.
  bool ok = vkAllocateCommandBuffers(device, &cmdInfo, &cmd) == VK_SUCCESS &&
            vkCreateFence(device, &fenceInfo, nullptr, &fence) == VK_SUCCESS;
  for (VkDeviceSize copied = 0; ok && copied < size;) {
    const VkDeviceSize bytes = std::min(staging->size(), size - copied);
    std::memcpy(staging->mapped(), static_cast<const uint8_t*>(data) + copied,
                static_cast<size_t>(bytes));
    ok = vmaFlushAllocation(ctx_.allocator(), staging->allocation_, 0, bytes) == VK_SUCCESS &&
         vkResetCommandPool(device, pool, 0) == VK_SUCCESS &&
         vkResetFences(device, 1, &fence) == VK_SUCCESS &&
         vkBeginCommandBuffer(cmd, &begin) == VK_SUCCESS;
    if (!ok) break;
    const VkBufferCopy region{0, offset + copied, bytes};
    VkBufferMemoryBarrier overwrite{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
    overwrite.srcAccessMask = VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT;
    overwrite.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    overwrite.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    overwrite.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    overwrite.buffer = buffer_;
    overwrite.offset = region.dstOffset;
    overwrite.size = bytes;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                         0, nullptr, 1, &overwrite, 0, nullptr);
    vkCmdCopyBuffer(cmd, staging->handle(), buffer_, 1, &region);
    VkMemoryBarrier ready{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    ready.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    ready.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, 0,
                         1, &ready, 0, nullptr, 0, nullptr);
    ok = vkEndCommandBuffer(cmd) == VK_SUCCESS &&
         vkQueueSubmit(ctx_.queue(), 1, &submit, fence) == VK_SUCCESS &&
         vkWaitForFences(device, 1, &fence, VK_TRUE, UINT64_MAX) == VK_SUCCESS;
    copied += bytes;
  }

  if (fence != VK_NULL_HANDLE) vkDestroyFence(device, fence, nullptr);
  vkDestroyCommandPool(device, pool, nullptr);
  return ok;
}

}  // namespace splatkit

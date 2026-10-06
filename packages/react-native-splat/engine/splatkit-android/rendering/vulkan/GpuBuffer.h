#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/VulkanContext.h"

namespace splatkit {

// Device-local buffers require staging; host-visible buffers allow mapped CPU writes.
class GpuBuffer {
 public:
  static std::unique_ptr<GpuBuffer> deviceLocal(const VulkanContext& ctx, VkDeviceSize size,
                                                VkBufferUsageFlags usage);
  static std::unique_ptr<GpuBuffer> hostVisible(const VulkanContext& ctx, VkDeviceSize size,
                                                VkBufferUsageFlags usage);
  ~GpuBuffer();

  GpuBuffer(const GpuBuffer&) = delete;
  GpuBuffer& operator=(const GpuBuffer&) = delete;

  VkBuffer handle() const { return buffer_; }
  VkDeviceSize size() const { return size_; }
  // Only for hostVisible buffers.
  void* mapped() const { return mapped_; }
  // Flush CPU writes because VMA prefers but cannot guarantee coherent memory.
  void flush(VkDeviceSize offset, VkDeviceSize size) const;
  // After a GPU-write fence, before reading a hostVisible buffer on the CPU.
  void invalidate(VkDeviceSize offset, VkDeviceSize size) const;

  // Blocking uploads use at most 2 MiB of fenced staging memory, suitable for loads rather than
  // frames.
  bool upload(const void* data, VkDeviceSize size) { return upload(0, data, size); }
  // Nonempty uploads require data; empty uploads accept null through size(), invalid ranges fail,
  // and failed copies may leave a prefix that callers must discard.
  bool upload(VkDeviceSize offset, const void* data, VkDeviceSize size);

 private:
  explicit GpuBuffer(const VulkanContext& ctx) : ctx_(ctx) {}

  const VulkanContext& ctx_;
  VkBuffer buffer_ = VK_NULL_HANDLE;
  VmaAllocation allocation_ = VK_NULL_HANDLE;
  VkDeviceSize size_ = 0;
  void* mapped_ = nullptr;
};

}

#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanContext.h"

namespace splatkit {

// A VkBuffer with its VMA allocation. Three flavours:
// - deviceLocal: lives in GPU memory, filled through a staging copy. Buffers the GPU writes.
// - deviceLocalMapped: GPU memory the CPU writes in place where the GPU shares it with the
//   CPU, as on phones, and deviceLocal elsewhere. A world, its LOD tree, a streamed slab.
// - hostVisible: mapped for CPU writes, read by the GPU. Uniforms and sort output.
class VulkanBuffer {
 public:
  static std::unique_ptr<VulkanBuffer> deviceLocal(const VulkanContext& ctx, VkDeviceSize size,
                                                   VkBufferUsageFlags usage);
  static std::unique_ptr<VulkanBuffer> deviceLocalMapped(const VulkanContext& ctx,
                                                         VkDeviceSize size,
                                                         VkBufferUsageFlags usage);
  static std::unique_ptr<VulkanBuffer> hostVisible(const VulkanContext& ctx, VkDeviceSize size,
                                                   VkBufferUsageFlags usage);
  ~VulkanBuffer();

  VulkanBuffer(const VulkanBuffer&) = delete;
  VulkanBuffer& operator=(const VulkanBuffer&) = delete;

  VkBuffer handle() const { return buffer_; }
  VkDeviceSize size() const { return size_; }
  // Set for hostVisible buffers, and for deviceLocalMapped ones that got shared memory.
  void* mapped() const { return mapped_; }
  // The memory type VMA picked.
  VkMemoryPropertyFlags memoryProperties() const { return properties_; }
  // Required after every CPU write to a hostVisible buffer: VMA only prefers coherent
  // memory, it does not guarantee it. A no-op when the memory is coherent.
  void flush(VkDeviceSize offset, VkDeviceSize size) const;
  // After a GPU-write fence, before reading a hostVisible buffer on the CPU.
  void invalidate(VkDeviceSize offset, VkDeviceSize size) const;

  // Blocking upload through <=2 MiB of staging memory, fenced before each reuse; a mapped
  // buffer takes the bytes in place instead, which the caller orders after every GPU read
  // of the range. Fine for a world load or a tile; not for per-frame data.
  bool upload(const void* data, VkDeviceSize size) { return upload(0, data, size); }
  // The same into [offset, offset + size) of the buffer, for a tile landing in a slab.
  // Nonempty copies require nonnull data.
  // Empty copies accept null data at any offset through size(). Invalid ranges fail.
  // A failed nonempty upload may have copied a prefix; the caller must discard it.
  bool upload(VkDeviceSize offset, const void* data, VkDeviceSize size);

 private:
  explicit VulkanBuffer(const VulkanContext& ctx) : ctx_(ctx) {}

  const VulkanContext& ctx_;
  VkBuffer buffer_ = VK_NULL_HANDLE;
  VmaAllocation allocation_ = VK_NULL_HANDLE;
  VkDeviceSize size_ = 0;
  VkMemoryPropertyFlags properties_ = 0;
  void* mapped_ = nullptr;
};

}  // namespace splatkit

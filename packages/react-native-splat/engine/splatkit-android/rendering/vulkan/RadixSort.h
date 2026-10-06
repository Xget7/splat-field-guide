#pragma once

#include <array>
#include <memory>
#include <string>

#include "rendering/vulkan/GpuBuffer.h"
#include "splat/core/Result.h"

namespace splatkit {

// Ascending LSD sort is stable and low16 ignores upper bits.
// The render thread fences each slot before encode/reuse and all slots before growth or
// destruction, retaining context and inputs until completion.
// Input buffers are read-only and must not alias owned outputs or scratch, even through distinct
// handles; caller offsets and sizes must be accurate.
class RadixSort {
 public:
  enum class KeyBits : uint32_t { full32, low16 };
  struct Capabilities {
    bool supported = false;
    uint32_t subgroupSize = 0;
    std::string reason;
  };
  struct Input {
    VkBuffer keys = VK_NULL_HANDLE;
    VkBuffer values = VK_NULL_HANDLE;
    VkBuffer count = VK_NULL_HANDLE;
    VkDeviceSize keysBytes = 0, valuesBytes = 0, countBytes = 4;
    KeyBits keyBits = KeyBits::full32;
    VkDeviceSize keysOffset = 0, valuesOffset = 0, countOffset = 0;
  };
  struct Output {
    VkBuffer keys = VK_NULL_HANDLE, values = VK_NULL_HANDLE;
    VkBuffer count = VK_NULL_HANDLE, status = VK_NULL_HANDLE;
  };
  static constexpr uint32_t kSlots = 2, kBlock = 2048, kMaxCapacity = 3000000;
  static constexpr uint32_t kInvalidCount = 1;
  static Capabilities queryCapabilities(const VulkanContext& ctx);
  static splat::Result<std::unique_ptr<RadixSort>> create(const VulkanContext& ctx);
  ~RadixSort();
  RadixSort(const RadixSort&) = delete;
  RadixSort& operator=(const RadixSort&) = delete;
  // Growth preserves old resources on failure; zero reserves one element.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }
  // Storage-buffer inputs over capacity fail on the GPU with zero count and kInvalidCount, so
  // consumers use the checked output count.
  // Same-queue input and compute/vertex/transfer output dependencies are included; callers own
  // cross-queue synchronization and host flush/invalidate.
  bool encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const;
  // Borrowed handles expire on growth or destruction; count and status use four-byte ranges.
  Output output(uint32_t slot) const;

 private:
  explicit RadixSort(const VulkanContext& ctx) : ctx_(ctx) {}
  bool initialize();
  struct Slot {
    std::array<std::unique_ptr<GpuBuffer>, 2> keys, values;
    std::unique_ptr<GpuBuffer> histogram, totals, state, count, status;
  };
  const VulkanContext& ctx_;
  uint32_t capacity_ = 0;
  std::array<Slot, kSlots> slots_;
  VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
  VkDescriptorPool pool_ = VK_NULL_HANDLE;
  VkPipelineLayout layout_ = VK_NULL_HANDLE;
  enum Stage : uint32_t { kPrepare, kHistogram, kScan, kScatter, kStageCount };
  std::array<VkPipeline, kStageCount> pipelines_{};
  // First pass external->B; second B->A; subsequent A->B and B->A.
  static constexpr uint32_t kSets = 3;
  std::array<std::array<VkDescriptorSet, kSets>, kSlots> sets_{};
};
}

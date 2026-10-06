#pragma once

#include <array>
#include <memory>
#include <string>

#include "rendering/vulkan/GpuBuffer.h"
#include "splat/core/Result.h"

namespace splatkit {

// Stable ascending LSD radix sort. Render-thread only; never submits or reads a GPU count.
// Context and input allocations outlive execution. Fence a slot before encode/reuse, and
// fence ALL slots before reserve/destruction. One encode per slot per outstanding submission.
// Inputs are read-only, separate uint32 key/value arrays; low16 ignores upper key bits.
// Output never aliases input. Passing any owned output/scratch as input is rejected; distinct
// VkBuffer handles must not alias the same memory. External offsets/sizes must be truthful.
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
  // Transactional growth; zero reserves one element. Failure preserves all old resources.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }
  // Buffers require STORAGE_BUFFER usage. Input count > capacity fails closed on GPU:
  // output count=0/status=kInvalidCount. Caller must consume output count, not input count.
  // Input dependencies (same queue) and compute/vertex/transfer output visibility included.
  // Queue ownership and cross-queue semaphores, host flush/invalidate remain caller-owned.
  bool encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const;
  // Borrowed handles valid until growth/destruction. count/status are four-byte ranges.
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
}  // namespace splatkit

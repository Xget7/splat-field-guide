#pragma once

#include <array>
#include <memory>
#include <string>
#include <utility>

#include "rendering/vulkan/device/VulkanBuffer.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "rendering/vulkan/layout/VulkanSortKeys.h"
#include "splat/core/Result.h"

namespace splatkit {

// Stable ascending LSD radix sort. Render-thread only; never submits or reads a GPU count.
// Context and input allocations outlive execution. Fence a slot before encode/reuse, and
// fence ALL slots before reserve/destruction. One encode per slot per outstanding submission.
// Inputs are read-only, separate uint32 key/value arrays; low16 ignores upper key bits.
// Output never aliases input. Passing any owned output/scratch as input is rejected; distinct
// VkBuffer handles must not alias the same memory. External offsets/sizes must be truthful.
class VulkanRadixSort {
 public:
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
  // The sorted values; the keys are left unsorted, nothing reads them after the sort.
  struct Output {
    VkBuffer values = VK_NULL_HANDLE;
    VkBuffer count = VK_NULL_HANDLE, status = VK_NULL_HANDLE;
  };
  static constexpr uint32_t kBlock = 2048, kMaxCapacity = 4'000'000;
  static constexpr uint32_t kInvalidCount = 1;
  // kScatterLast is the scatter specialised to skip the keys on the final digit.
  enum Stage : uint32_t { kPrepare, kHistogram, kScan, kScatter, kScatterLast, kStageCount };
  // The layouts and compute pipelines, which depend on no world. Compile them once and hand
  // them to every sort, so loading another world compiles nothing.
  struct Pipelines {
    // Null when the device lacks the capabilities or a pipeline fails to build.
    static std::shared_ptr<const Pipelines> compile(const VulkanContext& ctx);
    explicit Pipelines(VkDevice device) : device(device) {}
    ~Pipelines();
    Pipelines(const Pipelines&) = delete;
    Pipelines& operator=(const Pipelines&) = delete;

    VkDevice device;
    VkDescriptorSetLayout set = VK_NULL_HANDLE;
    VkPipelineLayout layout = VK_NULL_HANDLE;
    std::array<VkPipeline, kStageCount> stages{};
  };
  static Capabilities queryCapabilities(const VulkanContext& ctx);
  // Compiles its own pipelines, for a sort that shares them with no other.
  static splat::Result<std::unique_ptr<VulkanRadixSort>> create(const VulkanContext& ctx);
  static splat::Result<std::unique_ptr<VulkanRadixSort>> create(
      const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines);
  ~VulkanRadixSort();
  VulkanRadixSort(const VulkanRadixSort&) = delete;
  VulkanRadixSort& operator=(const VulkanRadixSort&) = delete;
  // Transactional growth; zero reserves one element. Failure preserves all old resources.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }
  const std::shared_ptr<const Pipelines>& pipelines() const { return pipelines_; }
  // Buffers require STORAGE_BUFFER usage. Input count > capacity fails closed on GPU:
  // output count=0/status=kInvalidCount. Caller must consume output count, not input count.
  // Input dependencies (same queue) and compute/vertex/transfer output visibility included.
  // Queue ownership and cross-queue semaphores, host flush/invalidate remain caller-owned.
  bool encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const;
  // Borrowed handles valid until growth/destruction. count/status are four-byte ranges.
  Output output(uint32_t slot) const;

 private:
  VulkanRadixSort(const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines)
      : ctx_(ctx), pipelines_(std::move(pipelines)) {}
  bool allocateSets();
  struct Slot {
    std::array<std::unique_ptr<VulkanBuffer>, 2> keys, values;
    std::unique_ptr<VulkanBuffer> histogram, totals, state, count, status;
    bool owns(VkBuffer buffer) const;
  };
  bool ownsBuffer(VkBuffer buffer) const;
  // A bounds, alignment and aliasing check of one external input range.
  bool acceptsRange(VkBuffer buffer, VkDeviceSize offset, VkDeviceSize total,
                    VkDeviceSize range) const;
  bool acceptsInput(const Input& input) const;
  void writeDescriptorSets(uint32_t slot, const Input& input) const;
  // Prepare, then one histogram/scan/scatter round per digit of the key.
  void recordSort(VkCommandBuffer cmd, uint32_t slot, KeyBits keyBits) const;
  const VulkanContext& ctx_;
  std::shared_ptr<const Pipelines> pipelines_;
  uint32_t capacity_ = 0;
  std::array<Slot, kFramesInFlight> slots_;
  VkDescriptorPool pool_ = VK_NULL_HANDLE;
  // First pass external->B; second B->A; subsequent A->B and B->A.
  static constexpr uint32_t kSets = 3;
  std::array<std::array<VkDescriptorSet, kSets>, kFramesInFlight> sets_{};
};
}  // namespace splatkit

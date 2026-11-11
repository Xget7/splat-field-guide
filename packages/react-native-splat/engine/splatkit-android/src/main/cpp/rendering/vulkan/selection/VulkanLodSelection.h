#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <memory>
#include <utility>

#include "rendering/vulkan/device/VulkanBuffer.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "splat/lod/LodTree.h"

namespace splatkit {

// Full hierarchy residency; interior-only GPU traversal and cooperative leaf packets.
// SSE matches MetalLodSelection's covariance/appearance metadata heuristic, not an image-error
// bound.
// Render thread only. Context outlives this pass. Upload/destroy require all consumers idle.
// One scratch/output domain: encode AND consumers must be ordered on the same context queue.
// The next encode overwrites output; copy diagnostics before it. No implicit submit/wait.
class VulkanLodSelection {
 public:
  struct Quality {
    float pixelLimit = 1.0f;  // zero requests exact leaves if capacity permits
    float colorWeight = 4.0f;
    bool frustumCull = true;
  };
  struct Input {
    VkBuffer camera = VK_NULL_HANDLE;  // CameraUniform, caller-owned/flush before encode
    VkDeviceSize cameraOffset = 0;     // minUniformBufferOffsetAlignment; buffer must cover range
  };
  struct Output {
    VkBuffer indices =
        VK_NULL_HANDLE;               // original LodTree node indices, uint32, count valid entries
    VkBuffer state = VK_NULL_HANDLE;  // count/diagnostics at constants below, TRANSFER_SRC capable
    uint32_t capacity = 0;
  };
  // Metal's ceiling; buffers scale with the budget a world loads with.
  static constexpr uint32_t kMaxBudget = 4'000'000;
  static constexpr VkDeviceSize kCountOffset = 0;
  static constexpr VkDeviceSize kLimitedOffset = 16;
  static constexpr VkDeviceSize kEvaluatedOffset = 20;
  static constexpr VkDeviceSize kDiagnosticBytes = 24;

  // The layouts and the compute pipeline, which depend on neither tree nor budget. Compile them
  // once and hand them to every selection, so loading another world compiles nothing.
  struct Pipelines {
    // Null when the device's limits fall short or the pipeline fails to build.
    static std::shared_ptr<const Pipelines> compile(const VulkanContext& ctx);
    explicit Pipelines(VkDevice device) : device(device) {}
    ~Pipelines();
    Pipelines(const Pipelines&) = delete;
    Pipelines& operator=(const Pipelines&) = delete;

    VkDevice device;
    VkDescriptorSetLayout set = VK_NULL_HANDLE;
    VkPipelineLayout layout = VK_NULL_HANDLE;
    VkPipeline pipeline = VK_NULL_HANDLE;
  };

  // Compiles its own pipelines, for a selection that shares them with no other.
  static splat::Result<std::unique_ptr<VulkanLodSelection>> create(const VulkanContext& ctx);
  static splat::Result<std::unique_ptr<VulkanLodSelection>> create(
      const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines);
  ~VulkanLodSelection();
  VulkanLodSelection(const VulkanLodSelection&) = delete;
  VulkanLodSelection& operator=(const VulkanLodSelection&) = delete;

  // Transactional, bounded allocation/upload; failure preserves old hierarchy and descriptors.
  // Budget must be 1..kMaxBudget; effective capacity is min(budget, original leaf count).
  // Source metadata, scratch and output must each fit maxStorageBufferRange.
  // Metadata may be built once at upload for v1 trees, never on the CPU per frame.
  bool upload(const splat::LodTree& tree, uint32_t budget, Quality quality);
  bool upload(const splat::LodTree& tree, uint32_t budget) {
    return upload(tree, budget, Quality{});
  }
  // Fence before reusing this descriptor slot; camera remains valid through completion.
  // Publishes indices/count to compute/indirect/transfer consumers with Vulkan 1.1 barriers.
  bool encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const;
  Output output() const;
  uint32_t capacity() const { return capacity_; }
  const std::shared_ptr<const Pipelines>& pipelines() const { return pipelines_; }
  // The most nodes the next selection may emit; never above capacity().
  uint32_t limit() const { return config_.limit; }
  // Applies at the next encode. Zero restores capacity().
  void setSplatLimit(uint32_t splats) {
    config_.limit = splats == 0 ? capacity_ : std::min(splats, capacity_);
  }
  void setPixelLimit(float pixels) { config_.pixelLimit = pixels; }

 private:
  VulkanLodSelection(const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines)
      : ctx_(ctx), pipelines_(std::move(pipelines)) {}
  bool allocateSets();
  struct Config {
    uint32_t phase = 0, limit = 0, costs = 0, offsets = 0;
    uint32_t costGroups = 0, groups = 0, blocks = 0, frontier0 = 0;
    uint32_t frontier1 = 0, packets = 0;
    float pixelLimit = 1, colorWeight = 4;
    uint32_t cull = 1;
  } config_;
  const VulkanContext& ctx_;
  std::shared_ptr<const Pipelines> pipelines_;
  VkPhysicalDeviceLimits limits_{};
  uint32_t capacity_ = 0;
  uint32_t rounds_ = 0;
  VkDescriptorPool pool_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, kFramesInFlight> sets_{};
  std::unique_ptr<VulkanBuffer> clusters_, leaves_, scratch_, indices_;
};

}  // namespace splatkit

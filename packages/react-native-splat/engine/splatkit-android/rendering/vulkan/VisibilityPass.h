#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/GpuBuffer.h"
#include "rendering/vulkan/VulkanContext.h"
#include "splat/core/Result.h"

namespace splatkit {

// The capability gate for the first Vulkan visibility seam.  The implementation deliberately
// requires subgroup arithmetic in the compute stage: a device without it keeps the CPU path.
struct VisibilityCapabilities {
  bool supported = false;
  uint32_t subgroupSize = 0;
  VkShaderStageFlags supportedStages = 0;
  VkSubgroupFeatureFlags supportedOperations = 0;
  uint32_t maxComputeWorkGroupInvocations = 0;
  uint32_t maxComputeWorkGroupSizeX = 0;
  uint32_t maxComputeWorkGroupCountX = 0;
  uint32_t maxComputeWorkGroupCountY = 0;
  VkDeviceSize maxStorageBufferRange = 0;
  std::string reason;
};

// GPU visibility/compaction; sorting must consume its output before rasterization.
// Render-thread only. Context and inputs outlive submitted work. Reserve/destroy while all
// consumers are idle; fence before reusing a descriptor slot. No implicit submit/count readback.
class VisibilityPass {
 public:
  static VisibilityCapabilities queryCapabilities(const VulkanContext& ctx);
  static splat::Result<std::unique_ptr<VisibilityPass>> create(const VulkanContext& ctx,
                                                               float minPixelRadius = 0.5f);
  ~VisibilityPass();

  VisibilityPass(const VisibilityPass&) = delete;
  VisibilityPass& operator=(const VisibilityPass&) = delete;

  // Transactional output allocation, 1..kMaxCapacity. Independent of resident source count.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }
  float minPixelRadius() const { return minPixelRadius_; }
  // Per-instance policy; render thread while the pass is idle. Finite and >= 0 or false.
  bool setMinPixelRadius(float radius);
  const VisibilityCapabilities& capabilities() const { return capabilities_; }

  enum class CandidateMode : uint32_t { prefix, indices, ranges };
  enum class KeyBits : uint32_t { full32, low16 };
  enum class KeyOrder : uint32_t { ascending, descending };
  struct Range {
    uint32_t offset, count, prefixEnd, pad;
  };
  static_assert(sizeof(Range) == 16);
  struct Input {
    VkBuffer camera = VK_NULL_HANDLE;  // CameraUniform, 8384-byte std140
    VkDeviceSize cameraOffset = 0;
    VkBuffer splats = VK_NULL_HANDLE;  // resident GpuSplat records, 32 bytes each
    VkDeviceSize splatsOffset = 0;
    uint32_t sourceCount = 0;
    // Actual total buffer sizes, including offsets. Caller owns truthful sizes and uploads.
    VkDeviceSize cameraBytes = 8384;
    VkDeviceSize splatsBytes = 0;
    CandidateMode mode = CandidateMode::prefix;
    VkBuffer candidates = VK_NULL_HANDLE;  // uint indices, or 16-byte Range records
    VkDeviceSize candidatesOffset = 0;
    VkDeviceSize candidatesBytes = 0;
    VkBuffer candidateCount = VK_NULL_HANDLE;  // indices mode only: GPU uint count (LOD offset0)
    VkDeviceSize candidateCountOffset = 0;
    VkDeviceSize candidateCountBytes = 0;
    // Dispatch upper bound, independent of output capacity. Prefix zero means sourceCount;
    // otherwise selects first N records. Indices zero means empty bound, not resident count.
    uint32_t candidateCapacity = 0;
    // Host validates sorted nonoverlap, positive counts and cumulative prefixEnd == bound.
    uint32_t rangeCount = 0;
    KeyBits keyBits = KeyBits::full32;
    KeyOrder keyOrder = KeyOrder::ascending;
  };

  struct Output {
    // Borrowed handles. Valid until successful reserve or destruction, never CPU-mapped.
    VkBuffer indices = VK_NULL_HANDLE;    // compacted original source indices
    VkBuffer depthKeys = VK_NULL_HANDLE;  // camera-depth key, configured precision/direction
    VkBuffer count = VK_NULL_HANDLE;      // GPU survivor count
    VkBuffer indirect = VK_NULL_HANDLE;   // one VkDrawIndirectCommand (4 vertices/instance)
    VkBuffer status = VK_NULL_HANDLE;     // bit 0 means output-capacity overflow
  };

  // Rejects malformed/undersized/misaligned descriptors before recording. Inactive bindings
  // use valid owned dummy ranges. Indexed/range source lookup is bounded on the GPU.
  // Any GPU failure zeros BOTH count and draw instanceCount; status preserves diagnostic bits.
  // Upload/host flush dependencies are caller-owned; outputs publish to compute/vertex/transfer
  // and indirect consumers. Readback requires completion and noncoherent invalidation.
  // Low16 near/far quantization is approximate. Equal keys have nondeterministic compaction
  // order; stable radix alone cannot make their input order deterministic across frames.
  bool encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const;
  Output output(uint32_t slot) const;

  static constexpr uint32_t kSlots = 2;
  static constexpr uint32_t kWorkgroupSize = 128;
  static constexpr uint32_t kMaxCapacity = 3000000;
  static constexpr uint32_t kOverflow = 1u;
  static constexpr uint32_t kInvalidIndex = 2u;
  static constexpr uint32_t kInvalidCount = 4u;
  static constexpr uint32_t kInvalidRange = 8u;
  static constexpr uint32_t kInvalidProjection = 16u;

 private:
  explicit VisibilityPass(const VulkanContext& ctx, VisibilityCapabilities capabilities,
                          float minPixelRadius)
      : ctx_(ctx), capabilities_(std::move(capabilities)), minPixelRadius_(minPixelRadius) {}

  bool createDescriptors();
  bool createPipelines();
  bool updateDescriptors(uint32_t slot, const Input& input) const;
  static void barrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage,
                      VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                      VkAccessFlags dstAccess, const Output& output);

  const VulkanContext& ctx_;
  VisibilityCapabilities capabilities_;
  float minPixelRadius_ = 0.5f;
  uint32_t capacity_ = 0;

  VkDescriptorSetLayout visibilitySetLayout_ = VK_NULL_HANDLE;
  VkDescriptorSetLayout prepareSetLayout_ = VK_NULL_HANDLE;
  VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, kSlots> visibilitySets_{};
  std::array<VkDescriptorSet, kSlots> prepareSets_{};
  VkPipelineLayout visibilityLayout_ = VK_NULL_HANDLE;
  VkPipelineLayout prepareLayout_ = VK_NULL_HANDLE;
  VkPipeline visibilityPipeline_ = VK_NULL_HANDLE;
  VkPipeline preparePipeline_ = VK_NULL_HANDLE;

  std::unique_ptr<GpuBuffer> dummy_;  // immutable zero words for inactive input descriptors
  std::array<std::unique_ptr<GpuBuffer>, kSlots> indices_{};
  std::array<std::unique_ptr<GpuBuffer>, kSlots> depthKeys_{};
  std::array<std::unique_ptr<GpuBuffer>, kSlots> counts_{};
  std::array<std::unique_ptr<GpuBuffer>, kSlots> indirect_{};
  std::array<std::unique_ptr<GpuBuffer>, kSlots> status_{};
};

}  // namespace splatkit

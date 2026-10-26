#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanBuffer.h"
#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "rendering/vulkan/layout/VulkanShaderTypes.h"
#include "rendering/vulkan/layout/VulkanSortKeys.h"
#include "splat/core/Result.h"

namespace splatkit {

// The capability gate for the first Vulkan visibility seam.  The implementation deliberately
// requires subgroup arithmetic in the compute stage: a device without it keeps the CPU path.
struct VulkanVisibilityCapabilities {
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

// GPU visibility, projection and compaction: each survivor's ProjectedSplat (GpuLayout.h) is
// written once for the draw. Sorting must consume its output before rasterization.
// Render-thread only. Context and inputs outlive submitted work. Reserve/destroy while all
// consumers are idle; fence before reusing a descriptor slot. No implicit submit/count readback.
class VulkanVisibilityPass {
 public:
  static VulkanVisibilityCapabilities queryCapabilities(const VulkanContext& ctx);

  // The layouts and compute pipelines, which depend on no world. Compile them once and hand
  // them to every pass, so loading another world compiles nothing.
  struct Pipelines {
    // Null when the device lacks the capabilities or a pipeline fails to build.
    static std::shared_ptr<const Pipelines> compile(const VulkanContext& ctx);
    explicit Pipelines(VkDevice device) : device(device) {}
    ~Pipelines();
    Pipelines(const Pipelines&) = delete;
    Pipelines& operator=(const Pipelines&) = delete;

    VkDevice device;
    VkDescriptorSetLayout visibilitySet = VK_NULL_HANDLE;
    VkDescriptorSetLayout prepareSet = VK_NULL_HANDLE;
    VkPipelineLayout visibilityLayout = VK_NULL_HANDLE;
    VkPipelineLayout prepareLayout = VK_NULL_HANDLE;
    // One pipeline per SH degree, specialised so degree 0 worlds pay nothing for SH.
    std::array<VkPipeline, kMaxShDegree + 1> visibility{};
    VkPipeline prepare = VK_NULL_HANDLE;
  };

  // Compiles its own pipelines, for a pass that shares them with no other.
  static splat::Result<std::unique_ptr<VulkanVisibilityPass>> create(const VulkanContext& ctx);
  static splat::Result<std::unique_ptr<VulkanVisibilityPass>> create(
      const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines);
  ~VulkanVisibilityPass();

  VulkanVisibilityPass(const VulkanVisibilityPass&) = delete;
  VulkanVisibilityPass& operator=(const VulkanVisibilityPass&) = delete;

  // Transactional output allocation, 1..kMaxCapacity. Independent of resident source count.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }
  const VulkanVisibilityCapabilities& capabilities() const { return capabilities_; }
  const std::shared_ptr<const Pipelines>& pipelines() const { return pipelines_; }

  enum class CandidateMode : uint32_t { prefix, indices, ranges };
  enum class KeyOrder : uint32_t { ascending, descending };
  struct Range {
    uint32_t offset, count, prefixEnd, pad;
  };
  static_assert(sizeof(Range) == 16);
  struct Input {
    VkBuffer camera = VK_NULL_HANDLE;  // CameraUniform, std140
    VkDeviceSize cameraOffset = 0;
    VkBuffer splats = VK_NULL_HANDLE;  // resident GpuSplat records, 32 bytes each
    VkDeviceSize splatsOffset = 0;
    uint32_t sourceCount = 0;
    // Harmonics bands 1 to shDegree, shStride(shDegree) uints per source record. Degree 0
    // never reads it and may leave it null.
    VkBuffer sh = VK_NULL_HANDLE;
    VkDeviceSize shOffset = 0;
    int shDegree = 0;
    // Actual total buffer sizes, including offsets. Caller owns truthful sizes and uploads.
    VkDeviceSize cameraBytes = sizeof(CameraUniform);
    VkDeviceSize splatsBytes = 0;
    VkDeviceSize shBytes = 0;
    // Field Guide: the world's label stream, one byte per source record packed into uint words,
    // and the frame's GuideUniform (std140) with the reveal and one style per label.
    VkBuffer labels = VK_NULL_HANDLE;
    VkDeviceSize labelsOffset = 0;
    VkDeviceSize labelsBytes = 0;
    VkBuffer guide = VK_NULL_HANDLE;
    VkDeviceSize guideOffset = 0;
    VkDeviceSize guideBytes = 0;
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
    VkBuffer values = VK_NULL_HANDLE;     // base + rank: each survivor's position in projected
    VkBuffer projected = VK_NULL_HANDLE;  // ProjectedSplat records, compacted
    VkBuffer depthKeys = VK_NULL_HANDLE;  // camera-depth key, configured precision/direction
    VkBuffer count = VK_NULL_HANDLE;      // GPU survivor count
    VkBuffer indirect = VK_NULL_HANDLE;   // one VkDrawIndirectCommand (4 vertices/instance)
    VkBuffer status = VK_NULL_HANDLE;     // bit 0 means output-capacity overflow
  };

  // Rejects malformed/undersized/misaligned descriptors before recording. Inactive bindings
  // use valid owned dummy ranges. Indexed/range source lookup is bounded on the GPU.
  // Any GPU failure zeros BOTH count and draw instanceCount; status preserves diagnostic bits.
  // Upload/host flush dependencies are caller-owned; outputs publish to compute/vertex/transfer
  // and indirect consumers, the projected records to the vertex stage. Readback requires
  // completion and noncoherent invalidation.
  // Low16 near/far quantization is approximate. Equal keys have nondeterministic compaction
  // order; stable radix alone cannot make their input order deterministic across frames.
  bool encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const;
  Output output(uint32_t slot) const;

  static constexpr uint32_t kWorkgroupSize = 128;
  static constexpr uint32_t kMaxCapacity = 4'000'000;
  static constexpr uint32_t kOverflow = 1u;
  static constexpr uint32_t kInvalidIndex = 2u;
  static constexpr uint32_t kInvalidCount = 4u;
  static constexpr uint32_t kInvalidRange = 8u;
  static constexpr uint32_t kInvalidProjection = 16u;

 private:
  VulkanVisibilityPass(const VulkanContext& ctx, VulkanVisibilityCapabilities capabilities,
                       std::shared_ptr<const Pipelines> pipelines)
      : ctx_(ctx), capabilities_(std::move(capabilities)), pipelines_(std::move(pipelines)) {}

  bool createDescriptors();
  bool updateDescriptors(uint32_t slot, const Input& input) const;
  static void barrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage,
                      VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                      VkAccessFlags dstAccess, const Output& output);

  const VulkanContext& ctx_;
  VulkanVisibilityCapabilities capabilities_;
  std::shared_ptr<const Pipelines> pipelines_;
  uint32_t capacity_ = 0;

  VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
  std::array<VkDescriptorSet, kFramesInFlight> visibilitySets_{};
  std::array<VkDescriptorSet, kFramesInFlight> prepareSets_{};

  std::unique_ptr<VulkanBuffer> dummy_;  // immutable zero words for inactive input descriptors
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> values_{};
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> projected_{};
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> depthKeys_{};
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> counts_{};
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> indirect_{};
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> status_{};
};

}  // namespace splatkit

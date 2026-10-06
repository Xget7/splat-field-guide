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

// GPU visibility requires subgroup arithmetic in the compute stage.
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

// Sort compacted output before rasterization; render-thread callers retain context and inputs,
// fence slots before reuse and idle all consumers before reserve/destruction.
// Encoding neither submits work nor reads GPU counts back.
class VisibilityPass {
 public:
  static VisibilityCapabilities queryCapabilities(const VulkanContext& ctx);
  static splat::Result<std::unique_ptr<VisibilityPass>> create(const VulkanContext& ctx,
                                                               float minPixelRadius = 0.5f);
  ~VisibilityPass();

  VisibilityPass(const VisibilityPass&) = delete;
  VisibilityPass& operator=(const VisibilityPass&) = delete;

  // Output allocation is transactional and independent of resident source count.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }
  float minPixelRadius() const { return minPixelRadius_; }
  // Change policy on the render thread while idle; reject non-finite or negative radii.
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
    // Callers supply full buffer sizes including offsets and own uploads.
    VkDeviceSize cameraBytes = 8384;
    VkDeviceSize splatsBytes = 0;
    CandidateMode mode = CandidateMode::prefix;
    VkBuffer candidates = VK_NULL_HANDLE;  // uint indices, or 16-byte Range records
    VkDeviceSize candidatesOffset = 0;
    VkDeviceSize candidatesBytes = 0;
    VkBuffer candidateCount = VK_NULL_HANDLE;  // indices mode only: GPU uint count (LOD offset0)
    VkDeviceSize candidateCountOffset = 0;
    VkDeviceSize candidateCountBytes = 0;
    // Dispatch capacity is independent of output capacity; zero means all source records in prefix
    // mode and no records in indices mode.
    uint32_t candidateCapacity = 0;
    // Host validates sorted nonoverlap, positive counts and cumulative prefixEnd == bound.
    uint32_t rangeCount = 0;
    KeyBits keyBits = KeyBits::full32;
    KeyOrder keyOrder = KeyOrder::ascending;
  };

  struct Output {
    // Borrowed GPU-only handles expire on successful reserve or destruction.
    VkBuffer indices = VK_NULL_HANDLE;    // compacted original source indices
    VkBuffer depthKeys = VK_NULL_HANDLE;  // camera-depth key, configured precision/direction
    VkBuffer count = VK_NULL_HANDLE;      // GPU survivor count
    VkBuffer indirect = VK_NULL_HANDLE;   // one VkDrawIndirectCommand (4 vertices/instance)
    VkBuffer status = VK_NULL_HANDLE;     // bit 0 means output-capacity overflow
  };

  // Malformed descriptors fail before recording, inactive bindings use owned dummy ranges, and GPU
  // source lookup is bounded.
  // Shader validation failures zero survivor and draw counts while preserving diagnostic status.
  // Callers own upload and host-flush dependencies; outputs publish to compute, vertex, transfer
  // and indirect consumers, with fenced/invalidate readback.
  // Low16 depth quantization is approximate, and stable radix sorting cannot remove
  // nondeterministic order among equal compacted keys.
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

}

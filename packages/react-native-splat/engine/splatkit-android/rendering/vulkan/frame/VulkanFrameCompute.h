#pragma once

#include <array>
#include <memory>
#include <optional>
#include <vector>

#include "rendering/vulkan/cull/VulkanVisibilityPass.h"
#include "rendering/vulkan/device/VulkanBuffer.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "rendering/vulkan/layout/VulkanSortKeys.h"
#include "rendering/vulkan/selection/VulkanLodSelection.h"
#include "rendering/vulkan/sort/VulkanRadixSort.h"
#include "splatkit/rendering/LodThreshold.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

// Resident-world GPU ordering. Owns LOD, culling, sorting and delayed diagnostics.
// Render thread only. Context/inputs outlive submissions. Create/destroy while idle;
// encode only after the caller's slot fence, with consumers on the same queue.
// Counts never return to CPU to decide dispatch/draw. Diagnostics lag by frame slots: a
// slot's are read when it is encoded again, or once its submission is known finished.
class VulkanFrameCompute {
 public:
  // Most splats one frame can keep, which bounds the visibility output and the sort.
  static constexpr uint32_t kMaxVisible = VulkanVisibilityPass::kMaxCapacity;
  // True when the device can run the GPU visibility and sort path.
  static bool supported(const VulkanContext& ctx);

  // Every compute pipeline a world runs. The renderer compiles them once and each world's
  // passes borrow them, so loading another world compiles nothing.
  struct Pipelines {
    // Nullopt when the device cannot run a pass or a pipeline fails to build.
    static std::optional<Pipelines> compile(const VulkanContext& ctx);
    bool operator==(const Pipelines& other) const {
      return visibility == other.visibility && radix == other.radix && lod == other.lod;
    }

    std::shared_ptr<const VulkanVisibilityPass::Pipelines> visibility;
    std::shared_ptr<const VulkanRadixSort::Pipelines> radix;
    std::shared_ptr<const VulkanLodSelection::Pipelines> lod;
  };

  // Compiles its own pipelines, for a world that shares them with no other.
  static splat::Result<std::unique_ptr<VulkanFrameCompute>> create(
      const VulkanContext& ctx, uint32_t sourceCount, const splat::LodTree* tree = nullptr,
      uint32_t budget = VulkanLodSelection::kMaxBudget);
  static splat::Result<std::unique_ptr<VulkanFrameCompute>> create(
      const VulkanContext& ctx, const Pipelines& pipelines, uint32_t sourceCount,
      const splat::LodTree* tree = nullptr, uint32_t budget = VulkanLodSelection::kMaxBudget);
  ~VulkanFrameCompute();
  VulkanFrameCompute(const VulkanFrameCompute&) = delete;
  VulkanFrameCompute& operator=(const VulkanFrameCompute&) = delete;

  struct Draw {
    VkBuffer order = VK_NULL_HANDLE;      // sorted positions in projected
    VkBuffer projected = VK_NULL_HANDLE;  // ProjectedSplat records
    VkBuffer arguments = VK_NULL_HANDLE;
    uint32_t capacity = 0;
  };
  struct Stats {
    uint32_t drawn = 0, selected = 0, limited = 0, evaluated = 0, status = 0;
    double sortMillis = 0, selectMillis = 0, cullMillis = 0;
  };
  // Nullopt means encoding failed; caller must still submit/end its acquired frame.
  // `sh` holds the harmonics bands 1 to `shDegree` of every splat; degree 0 never reads it.
  // `labels` is the world's label stream, styled by the frame's label styles and reveal.
  std::optional<Draw> encode(VkCommandBuffer cmd, uint32_t slot, VkBuffer camera,
                             const VulkanBuffer& splats, const VulkanBuffer& labels,
                             const VulkanBuffer& sh, int shDegree,
                             const SplatRenderer::Frame& frame);
  const Stats& stats() const { return stats_; }
  // The queue submission that carried the slot's last encode.
  void submitted(uint32_t slot, uint64_t submission);
  // Reads the diagnostics of every submitted frame up to `completedSubmission`, so a still
  // scene that encodes nothing new reports its last frame. Never moves back to an older one.
  void collectCompleted(uint64_t completedSubmission);
  bool hasLod() const { return lod_ != nullptr; }
  const Pipelines& pipelines() const { return pipelines_; }

  // Per-instance renderer policy. Render thread, while idle. Only sortDepth, lodErrorPixels
  // and lodSplatLimit are honoured; the caller resolves the rest, and writes the sub-pixel
  // cutoff into each frame's camera.
  bool applyRenderPolicy(const RenderPolicy& policy, std::string* reason);
  uint32_t sortKeyBits() const { return keyBitCount(keyBits()); }
  // The threshold the next hierarchy selection runs at.
  float lodPixels() const { return lodThreshold_.pixels(); }
  const VulkanVisibilityCapabilities& visibilityCapabilities() const {
    return visibility_->capabilities();
  }

 private:
  VulkanFrameCompute(const VulkanContext& ctx, Pipelines pipelines);
  KeyBits keyBits() const {
    return sortKeyBits_ == SortKeyBits::low16 ? KeyBits::low16 : KeyBits::full32;
  }
  bool initialize(uint32_t sourceCount, const splat::LodTree* tree, uint32_t budget);
  bool prepareRanges(uint32_t slot, const SplatRenderer::Frame& frame,
                     VulkanVisibilityPass::Input& input);
  void collect(uint32_t slot);
  void copyDiagnostics(VkCommandBuffer cmd, uint32_t slot,
                       const VulkanVisibilityPass::Output& visible, uint32_t candidates);

  struct RangeRecord {
    uint32_t offset, count, prefixEnd, pad;
  };
  static constexpr uint32_t kMaxRanges = 65536;
  const VulkanContext& ctx_;
  Pipelines pipelines_;
  uint32_t sourceCount_ = 0, capacity_ = 0;
  SortKeyBits sortKeyBits_ = RenderPolicy{}.sortDepth;
  uint32_t timestampBits_ = 0;
  float timestampPeriod_ = 0;
  std::unique_ptr<VulkanLodSelection> lod_;
  LodThreshold lodThreshold_{VulkanLodSelection::Quality{}.pixelLimit};
  std::unique_ptr<VulkanVisibilityPass> visibility_;
  std::unique_ptr<VulkanRadixSort> radix_;
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> ranges_, readback_;
  // Field Guide: per slot, the GuideUniform the slot's visibility pass reads, written by the
  // CPU only after the slot's fence, so a frame in flight keeps its styles and reveal.
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> guides_;
  std::array<VkQueryPool, kFramesInFlight> queries_{};
  std::array<bool, kFramesInFlight> pending_{};
  // Per slot, whether its selection ran under the policy in effect, so it may adapt.
  std::array<bool, kFramesInFlight> currentPolicy_{};
  // Per slot, the submission of the pending encode; 0 when not submitted.
  std::array<uint64_t, kFramesInFlight> submission_{};
  uint64_t collectedSubmission_ = 0;
  uint64_t lodReadbacks_ = 0;  // selections read so far, which paces the LOD log
  std::vector<RangeRecord> rangeRecords_;
  Stats stats_;
};

}  // namespace splatkit

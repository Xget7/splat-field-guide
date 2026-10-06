#pragma once

#include <array>
#include <memory>
#include <vector>

#include "rendering/vulkan/GpuBuffer.h"
#include "rendering/vulkan/VisibilityPass.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

class RadixSort;

// Render-thread culling and sorting stay on the GPU; idle creation/destruction, fenced slot reuse
// and one-queue consumers preserve input lifetimes, while diagnostics lag until slot completion.
class VulkanFrameCompute {
 public:
  static constexpr uint32_t kMaxVisible = VisibilityPass::kMaxCapacity;
  static splat::Result<std::unique_ptr<VulkanFrameCompute>> create(
      const VulkanContext& ctx, uint32_t sourceCount);
  ~VulkanFrameCompute();
  VulkanFrameCompute(const VulkanFrameCompute&) = delete;
  VulkanFrameCompute& operator=(const VulkanFrameCompute&) = delete;

  struct Draw {
    VkBuffer order = VK_NULL_HANDLE;
    VkBuffer arguments = VK_NULL_HANDLE;
    uint32_t capacity = 0;
  };
  struct Stats {
    uint32_t drawn = 0, selected = 0, limited = 0, evaluated = 0, status = 0;
    double sortMillis = 0, selectMillis = 0, cullMillis = 0;
  };
  // Nullopt means encoding failed; caller must still submit/end its acquired frame.
  std::optional<Draw> encode(VkCommandBuffer cmd, uint32_t slot, VkBuffer camera,
                             const GpuBuffer& splats, const SplatRenderer::Frame& frame);
  const Stats& stats() const { return stats_; }
  void submitted(uint32_t slot, uint64_t submission);
  // Collect completed submissions even while idle without replacing newer diagnostics with older
  // frames.
  void collectCompleted(uint64_t completedSubmission);

 private:
  explicit VulkanFrameCompute(const VulkanContext& ctx);
  bool initialize(uint32_t sourceCount);
  void collect(uint32_t slot);
  void copyDiagnostics(VkCommandBuffer cmd, uint32_t slot, const VisibilityPass::Output& visible,
                       uint32_t candidates);

  static constexpr uint32_t kSlots = 2;
  const VulkanContext& ctx_;
  uint32_t sourceCount_ = 0, capacity_ = 0;
  uint32_t timestampBits_ = 0;
  float timestampPeriod_ = 0;
  std::unique_ptr<VisibilityPass> visibility_;
  std::unique_ptr<RadixSort> radix_;
  std::array<std::unique_ptr<GpuBuffer>, kSlots> readback_;
  std::array<VkQueryPool, kSlots> queries_{};
  std::array<bool, kSlots> pending_{};
  std::array<uint64_t, kSlots> submission_{};  // of the pending encode; 0 when not submitted
  uint64_t collectedSubmission_ = 0;
  Stats stats_;
};

}

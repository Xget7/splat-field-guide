#pragma once

#include <array>
#include <vector>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/Swapchain.h"
#include "rendering/vulkan/VulkanContext.h"

namespace splatkit {

// Each of two frame slots owns a pool, fence and acquire semaphore; present semaphores belong to
// swapchain images because presentation can outlive slot reuse.
class FrameLoop {
 public:
  static constexpr uint32_t kFramesInFlight = 2;

  // The owner decides whether a presented SUBOPTIMAL frame requires a swapchain rebuild.
  enum class Status { ok, swapchainSuboptimal, swapchainOutOfDate, error };

  explicit FrameLoop(const VulkanContext& ctx);
  ~FrameLoop();

  FrameLoop(const FrameLoop&) = delete;
  FrameLoop& operator=(const FrameLoop&) = delete;

  bool valid() const { return valid_; }
  bool failed() const { return completionFailed_; }
  // Slot of the frame being recorded; valid between beginFrame and endFrame.
  uint32_t currentSlot() const { return current_; }

  // Call after a swapchain is created or recreated.
  bool onSwapchainCreated(const Swapchain& swapchain);

  Status beginFrame(const Swapchain& swapchain, uint32_t& imageIndex, VkCommandBuffer& cmd);
  Status endFrame(const Swapchain& swapchain, uint32_t imageIndex);

  uint64_t lastSubmission() const { return lastSubmission_; }
  // Poll fences even while idle to read completed timings; failed GPU work must never announce
  // readiness.
  uint64_t completedSubmission();

  // GPU timestamp duration is zero until completion or when unsupported and is independent of
  // vsync.
  double lastGpuMillis() const { return lastGpuMillis_; }

 private:
  struct Frame {
    VkCommandPool pool = VK_NULL_HANDLE;
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    VkFence inFlight = VK_NULL_HANDLE;
    VkSemaphore imageAvailable = VK_NULL_HANDLE;
    VkQueryPool timestamps = VK_NULL_HANDLE;  // two queries: start and end of the frame
    uint64_t submission = 0;                  // until the GPU is known to have finished it
  };

  void finish(Frame& frame);
  void destroyRenderFinished();

  const VulkanContext& ctx_;
  std::array<Frame, kFramesInFlight> frames_{};
  std::vector<VkSemaphore> renderFinished_;
  uint32_t current_ = 0;
  bool valid_ = false;
  float timestampPeriodNanos_ = 0;  // zero when the queue cannot timestamp
  double lastGpuMillis_ = 0;
  uint64_t lastSubmission_ = 0;
  uint64_t completedSubmission_ = 0;
  uint64_t timedSubmission_ = 0;  // the frame lastGpuMillis_ measures
  bool completionFailed_ = false;
};

}

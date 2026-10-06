#pragma once

#include <array>
#include <vector>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/Swapchain.h"
#include "rendering/vulkan/VulkanContext.h"

namespace splatkit {

// The per-frame synchronisation: command buffers, fences and semaphores.
//
// Two frames in flight: while the GPU draws frame N, the CPU records frame N+1.
// Per frame: a command pool (reset wholesale, cheaper than resetting buffers), the
// fence the CPU waits on before reusing it, and the semaphore signalled when the
// swapchain image is ready. Per swapchain image: the semaphore the present waits on,
// because presentation may still be reading it when the frame slot comes around again.
class FrameLoop {
 public:
  static constexpr uint32_t kFramesInFlight = 2;

  // `swapchainSuboptimal`: the frame was presented, but the surface reports the swapchain
  // no longer matches it. The owner decides whether that needs a rebuild.
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

  // Waits for this frame slot, acquires an image and begins recording.
  Status beginFrame(const Swapchain& swapchain, uint32_t& imageIndex, VkCommandBuffer& cmd);
  // Ends recording, submits and presents.
  Status endFrame(const Swapchain& swapchain, uint32_t imageIndex);

  uint64_t lastSubmission() const { return lastSubmission_; }
  // Nonblocking fence queries of the frames still in flight, including when the engine has
  // no new frame to draw; a finished frame's GPU time is read then too.
  // Zero after a fence/device error: failed GPU work must never announce readiness.
  uint64_t completedSubmission();

  // GPU time of the most recently completed frame, from timestamp queries at both ends
  // of its command buffer. Zero until the first frame completes or if unsupported.
  // Unlike wall time, this is not quantised by vsync, so it is the number to optimise.
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

}  // namespace splatkit

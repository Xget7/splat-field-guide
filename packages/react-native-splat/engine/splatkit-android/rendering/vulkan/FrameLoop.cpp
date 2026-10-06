#include "rendering/vulkan/FrameLoop.h"

#include <algorithm>

#include "splatkit/Log.h"

namespace splatkit {

FrameLoop::FrameLoop(const VulkanContext& ctx) : ctx_(ctx) {
  VkDevice device = ctx_.device();
  VkPhysicalDeviceProperties props{};
  vkGetPhysicalDeviceProperties(ctx_.physicalDevice(), &props);
  uint32_t familyCount = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(ctx_.physicalDevice(), &familyCount, nullptr);
  std::vector<VkQueueFamilyProperties> families(familyCount);
  vkGetPhysicalDeviceQueueFamilyProperties(ctx_.physicalDevice(), &familyCount, families.data());
  const bool canTimestamp = ctx_.queueFamily() < familyCount &&
                            families[ctx_.queueFamily()].timestampValidBits > 0 &&
                            props.limits.timestampPeriod > 0;
  timestampPeriodNanos_ = canTimestamp ? props.limits.timestampPeriod : 0.0f;

  for (Frame& frame : frames_) {
    if (canTimestamp) {
      VkQueryPoolCreateInfo queryInfo{VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO};
      queryInfo.queryType = VK_QUERY_TYPE_TIMESTAMP;
      queryInfo.queryCount = 2;
      if (vkCreateQueryPool(device, &queryInfo, nullptr, &frame.timestamps) != VK_SUCCESS) return;
    }
    VkCommandPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
    poolInfo.queueFamilyIndex = ctx_.queueFamily();
    poolInfo.flags = VK_COMMAND_POOL_CREATE_TRANSIENT_BIT;
    if (vkCreateCommandPool(device, &poolInfo, nullptr, &frame.pool) != VK_SUCCESS) return;

    VkCommandBufferAllocateInfo cmdInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
    cmdInfo.commandPool = frame.pool;
    cmdInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    cmdInfo.commandBufferCount = 1;
    if (vkAllocateCommandBuffers(device, &cmdInfo, &frame.cmd) != VK_SUCCESS) return;

    // Signalled at creation so the first wait returns immediately.
    VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
    fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;
    if (vkCreateFence(device, &fenceInfo, nullptr, &frame.inFlight) != VK_SUCCESS) return;

    const VkSemaphoreCreateInfo semInfo{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
    if (vkCreateSemaphore(device, &semInfo, nullptr, &frame.imageAvailable) != VK_SUCCESS) return;
  }
  valid_ = true;
}

FrameLoop::~FrameLoop() {
  VkDevice device = ctx_.device();
  vkDeviceWaitIdle(device);
  destroyRenderFinished();
  for (const Frame& frame : frames_) {
    if (frame.timestamps) vkDestroyQueryPool(device, frame.timestamps, nullptr);
    if (frame.imageAvailable) vkDestroySemaphore(device, frame.imageAvailable, nullptr);
    if (frame.inFlight) vkDestroyFence(device, frame.inFlight, nullptr);
    if (frame.pool) vkDestroyCommandPool(device, frame.pool, nullptr);
  }
}

void FrameLoop::destroyRenderFinished() {
  for (VkSemaphore s : renderFinished_) vkDestroySemaphore(ctx_.device(), s, nullptr);
  renderFinished_.clear();
}

bool FrameLoop::onSwapchainCreated(const Swapchain& swapchain) {
  destroyRenderFinished();
  renderFinished_.resize(swapchain.imageCount(), VK_NULL_HANDLE);
  const VkSemaphoreCreateInfo semInfo{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
  for (VkSemaphore& s : renderFinished_) {
    if (vkCreateSemaphore(ctx_.device(), &semInfo, nullptr, &s) != VK_SUCCESS) return false;
  }
  return true;
}

FrameLoop::Status FrameLoop::beginFrame(const Swapchain& swapchain, uint32_t& imageIndex,
                                        VkCommandBuffer& cmd) {
  VkDevice device = ctx_.device();
  Frame& frame = frames_[current_];

  // Bounded waits: a wedged driver must surface as an error, never as a hung UI thread.
  constexpr uint64_t kTimeoutNanos = 2'000'000'000ULL;

  // 1. Wait until the GPU finished the frame that last used this slot.
  if (vkWaitForFences(device, 1, &frame.inFlight, VK_TRUE, kTimeoutNanos) != VK_SUCCESS) {
    completionFailed_ = true;
    LOGE("frame fence timed out: GPU stalled or device lost");
    return Status::error;
  }
  finish(frame);

  // 2. Ask the swapchain for an image. The semaphore fires when it is really free.
  const VkResult acquired = vkAcquireNextImageKHR(
      device, swapchain.handle(), kTimeoutNanos, frame.imageAvailable, VK_NULL_HANDLE, &imageIndex);
  if (acquired == VK_ERROR_OUT_OF_DATE_KHR) return Status::swapchainOutOfDate;
  if (acquired != VK_SUCCESS && acquired != VK_SUBOPTIMAL_KHR) {
    LOGE("vkAcquireNextImageKHR failed: %d", acquired);
    return Status::error;
  }

  // Only reset the fence once we know we will submit, or the next wait would hang.
  vkResetFences(device, 1, &frame.inFlight);

  // 3. Start recording into a fresh command buffer.
  vkResetCommandPool(device, frame.pool, 0);
  VkCommandBufferBeginInfo beginInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
  beginInfo.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  if (vkBeginCommandBuffer(frame.cmd, &beginInfo) != VK_SUCCESS) return Status::error;
  if (frame.timestamps) {
    vkCmdResetQueryPool(frame.cmd, frame.timestamps, 0, 2);
    vkCmdWriteTimestamp(frame.cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, frame.timestamps, 0);
  }
  cmd = frame.cmd;
  return Status::ok;
}

FrameLoop::Status FrameLoop::endFrame(const Swapchain& swapchain, uint32_t imageIndex) {
  Frame& frame = frames_[current_];
  if (frame.timestamps) {
    vkCmdWriteTimestamp(frame.cmd, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, frame.timestamps, 1);
  }
  if (vkEndCommandBuffer(frame.cmd) != VK_SUCCESS) return Status::error;

  // 4. Submit: wait for the image before writing color, signal when the render is done.
  const VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
  submit.waitSemaphoreCount = 1;
  submit.pWaitSemaphores = &frame.imageAvailable;
  submit.pWaitDstStageMask = &waitStage;
  submit.commandBufferCount = 1;
  submit.pCommandBuffers = &frame.cmd;
  submit.signalSemaphoreCount = 1;
  submit.pSignalSemaphores = &renderFinished_[imageIndex];
  if (vkQueueSubmit(ctx_.queue(), 1, &submit, frame.inFlight) != VK_SUCCESS) {
    completionFailed_ = true;
    LOGE("vkQueueSubmit failed");
    return Status::error;
  }
  frame.submission = ++lastSubmission_;

  // 5. Present once the render is done.
  VkSwapchainKHR handle = swapchain.handle();
  VkPresentInfoKHR present{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
  present.waitSemaphoreCount = 1;
  present.pWaitSemaphores = &renderFinished_[imageIndex];
  present.swapchainCount = 1;
  present.pSwapchains = &handle;
  present.pImageIndices = &imageIndex;
  const VkResult presented = vkQueuePresentKHR(ctx_.queue(), &present);

  current_ = (current_ + 1) % kFramesInFlight;

  if (presented == VK_ERROR_OUT_OF_DATE_KHR) return Status::swapchainOutOfDate;
  // SUBOPTIMAL is permanent on Android whenever the swapchain pre-transform differs from
  // the display rotation (we use identity and let the compositor rotate), but it is also
  // all the emulator reports after a rotation that changed the surface size. The engine
  // compares extents to tell the two apart.
  if (presented == VK_SUBOPTIMAL_KHR) return Status::swapchainSuboptimal;
  if (presented != VK_SUCCESS) {
    completionFailed_ = true;
    LOGE("vkQueuePresentKHR failed: %d", presented);
    return Status::error;
  }
  return Status::ok;
}

uint64_t FrameLoop::completedSubmission() {
  if (completionFailed_) return 0;
  for (Frame& frame : frames_) {
    if (frame.submission == 0) continue;
    const VkResult status = vkGetFenceStatus(ctx_.device(), frame.inFlight);
    if (status == VK_SUCCESS) {
      finish(frame);
    } else if (status != VK_NOT_READY) {
      completionFailed_ = true;
      LOGE("frame completion query failed: %d", status);
      return 0;
    }
  }
  return completedSubmission_;
}

// Once per submitted frame, after its fence: marks it complete and reads its GPU time.
void FrameLoop::finish(Frame& frame) {
  if (frame.submission == 0) return;
  completedSubmission_ = std::max(completedSubmission_, frame.submission);
  // Slots are polled in order, not by age: an older frame keeps a newer one's time.
  if (frame.timestamps && frame.submission > timedSubmission_) {
    uint64_t ticks[2] = {0, 0};
    if (vkGetQueryPoolResults(ctx_.device(), frame.timestamps, 0, 2, sizeof(ticks), ticks,
                              sizeof(uint64_t), VK_QUERY_RESULT_64_BIT) == VK_SUCCESS) {
      lastGpuMillis_ = static_cast<double>(ticks[1] - ticks[0]) * timestampPeriodNanos_ * 1e-6;
      timedSubmission_ = frame.submission;
    }
  }
  frame.submission = 0;
}

}  // namespace splatkit

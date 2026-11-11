#pragma once

#include <atomic>
#include <memory>
#include <string>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>
// After vulkan.h on purpose: VkBootstrap.h would otherwise hide the prototypes.
#include <VkBootstrap.h>

#include "rendering/vulkan/device/VulkanPipelineCache.h"
#include "splat/core/Result.h"

namespace splatkit {

// Instance, physical device, logical device, the single graphics+present queue,
// the memory allocator and the pipeline cache. Created once per engine; outlives every surface.
class VulkanContext {
 public:
  // `pipelineCachePath` is the file the pipeline cache loads from and saves to; empty keeps
  // it in memory.
  static splat::Result<std::unique_ptr<VulkanContext>> create(std::string pipelineCachePath = {});
  ~VulkanContext();

  VulkanContext(const VulkanContext&) = delete;
  VulkanContext& operator=(const VulkanContext&) = delete;

  VkInstance instance() const { return instance_.instance; }
  VkPhysicalDevice physicalDevice() const { return device_.physical_device; }
  VkDevice device() const { return device_.device; }
  VkQueue queue() const { return queue_; }
  uint32_t queueFamily() const { return queueFamily_; }
  VmaAllocator allocator() const { return allocator_; }
  const vkb::Device& vkbDevice() const { return device_; }
  // "Adreno (TM) 640, Vulkan 1.1.128": what a HUD or a bug report wants to show.
  const std::string& deviceDescription() const { return deviceDescription_; }
  // The limits and features the GPU pipeline relies on, one line for logcat and
  // android_perf.py: subgroups, workgroup memory and size, storage range, device-local
  // memory, 16-bit arithmetic and storage.
  const std::string& capabilities() const { return capabilities_; }
  // Every pipeline is created through it, so a later world or launch reuses the compiles.
  // VK_NULL_HANDLE when the driver could not create one: pipelines then compile uncached.
  VkPipelineCache pipelineCache() const {
    return pipelineCache_ ? pipelineCache_->handle() : VK_NULL_HANDLE;
  }
  // Render thread, after pipelines were created. False when the file could not be written.
  bool savePipelineCache() const { return !pipelineCache_ || pipelineCache_->save(); }
  bool validationEnabled() const { return validationEnabled_; }
  uint32_t validationMessageCount() const { return validationMessageCount_.load(); }

  // True when the queue can present to this surface. Checked every time a surface arrives.
  bool supportsPresent(VkSurfaceKHR surface) const;
  void waitIdle() const;

 private:
  VulkanContext() = default;

  vkb::Instance instance_{};
  vkb::Device device_{};
  VkQueue queue_ = VK_NULL_HANDLE;
  uint32_t queueFamily_ = 0;
  VmaAllocator allocator_ = VK_NULL_HANDLE;
  std::unique_ptr<VulkanPipelineCache> pipelineCache_;
  std::string deviceDescription_;
  std::string capabilities_;
  bool validationEnabled_ = false;
  std::atomic<uint32_t> validationMessageCount_{0};
};

}  // namespace splatkit

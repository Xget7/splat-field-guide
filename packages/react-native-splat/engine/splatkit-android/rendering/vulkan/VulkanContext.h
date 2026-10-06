#pragma once

#include <atomic>
#include <memory>
#include <string>

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>
// After vulkan.h on purpose: VkBootstrap.h would otherwise hide the prototypes.
#include <VkBootstrap.h>

#include "splat/core/Result.h"

namespace splatkit {

// Instance, physical device, logical device, the single graphics+present queue,
// and the memory allocator. Created once per engine; outlives every surface.
class VulkanContext {
 public:
  static splat::Result<std::unique_ptr<VulkanContext>> create();
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
  std::string deviceDescription_;
  bool validationEnabled_ = false;
  std::atomic<uint32_t> validationMessageCount_{0};
};

}  // namespace splatkit

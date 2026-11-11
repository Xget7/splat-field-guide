#pragma once

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <vulkan/vulkan.h>

namespace splatkit {

// The device's VkPipelineCache, kept in one file so a launch reuses the previous launch's
// compiles. The file is our header (magic, version, data size, checksum) then the driver's
// data; a file that fails any check, or names another device or driver, loads as an empty
// cache. Render thread only: pipelines are created and the file is written there.
class VulkanPipelineCache {
 public:
  // Nullptr only when the driver cannot create a cache. An empty path never touches disk.
  static std::unique_ptr<VulkanPipelineCache> open(VkPhysicalDevice physicalDevice, VkDevice device,
                                                   std::string path);
  ~VulkanPipelineCache();
  VulkanPipelineCache(const VulkanPipelineCache&) = delete;
  VulkanPipelineCache& operator=(const VulkanPipelineCache&) = delete;

  VkPipelineCache handle() const { return cache_; }
  // Driver bytes the file contributed; 0 when it was missing or rejected.
  size_t loadedBytes() const { return loadedBytes_; }
  // Writes the file through a temporary and a rename when the cache grew since it was last
  // loaded or saved. False when the write fails; the previous file then stays intact.
  bool save();

  // Fills in a file's data size and checksum over the driver bytes after the header.
  static void seal(std::vector<char>& file);

 private:
  VulkanPipelineCache(VkDevice device, std::string path)
      : device_(device), path_(std::move(path)) {}

  VkDevice device_;
  std::string path_;
  VkPipelineCache cache_ = VK_NULL_HANDLE;
  size_t loadedBytes_ = 0;
  size_t savedBytes_ = 0;
};

}  // namespace splatkit

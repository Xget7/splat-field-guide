#include "rendering/vulkan/device/VulkanPipelineCache.h"

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>

#include <unistd.h>

#include "splatkit/Log.h"

namespace splatkit {
namespace {

constexpr uint32_t kMagic = 0x43504B53;  // "SKPC" in little-endian bytes
constexpr uint32_t kVersion = 1;
constexpr uint64_t kFnvOffset = 0xcbf29ce484222325ull;
constexpr uint64_t kFnvPrime = 0x100000001b3ull;
// A save writes a sibling first and renames it over the file, so a crash keeps the old one.
// The process id and a save count name the sibling, so engines sharing a directory never
// write into one another's.
constexpr char kTemporarySuffix[] = ".tmp";
std::atomic<uint32_t> gSaveCount{0};

struct FileHeader {
  uint32_t magic = kMagic;
  uint32_t version = kVersion;
  uint64_t dataSize = 0;
  uint64_t checksum = 0;
};
static_assert(sizeof(FileHeader) == 24);

uint64_t checksum(const char* data, size_t size) {
  uint64_t hash = kFnvOffset;
  for (size_t i = 0; i < size; ++i) {
    hash ^= static_cast<unsigned char>(data[i]);
    hash *= kFnvPrime;
  }
  return hash;
}

std::vector<char> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return {};
  return {std::istreambuf_iterator<char>(in), {}};
}

// Null when the file is usable, else why not. Checks the driver's own header too, since
// drivers differ in how they treat data from another device or driver.
const char* rejection(const std::vector<char>& file, const VkPhysicalDeviceProperties& device) {
  FileHeader header;
  if (file.size() < sizeof(header)) return "too short";
  std::memcpy(&header, file.data(), sizeof(header));
  const char* data = file.data() + sizeof(header);
  const size_t size = file.size() - sizeof(header);
  if (header.magic != kMagic || header.version != kVersion) return "not a SplatKit cache";
  if (header.dataSize != size) return "truncated";
  if (header.checksum != checksum(data, size)) return "damaged";
  VkPipelineCacheHeaderVersionOne vulkan{};
  if (size < sizeof(vulkan)) return "no driver header";
  std::memcpy(&vulkan, data, sizeof(vulkan));
  if (vulkan.headerSize < sizeof(vulkan) ||
      vulkan.headerVersion != VK_PIPELINE_CACHE_HEADER_VERSION_ONE ||
      vulkan.vendorID != device.vendorID || vulkan.deviceID != device.deviceID ||
      std::memcmp(vulkan.pipelineCacheUUID, device.pipelineCacheUUID, VK_UUID_SIZE) != 0)
    return "another device or driver";
  return nullptr;
}

}  // namespace

void VulkanPipelineCache::seal(std::vector<char>& file) {
  FileHeader header;
  if (file.size() < sizeof(header)) return;
  header.dataSize = file.size() - sizeof(header);
  header.checksum = checksum(file.data() + sizeof(header), header.dataSize);
  std::memcpy(file.data(), &header, sizeof(header));
}

std::unique_ptr<VulkanPipelineCache> VulkanPipelineCache::open(VkPhysicalDevice physicalDevice,
                                                               VkDevice device, std::string path) {
  std::unique_ptr<VulkanPipelineCache> cache(new VulkanPipelineCache(device, std::move(path)));
  std::vector<char> file;
  if (!cache->path_.empty()) {
    file = readFile(cache->path_);
    VkPhysicalDeviceProperties properties{};
    vkGetPhysicalDeviceProperties(physicalDevice, &properties);
    if (const char* reason = file.empty() ? "no file" : rejection(file, properties)) {
      LOGI("Vulkan pipeline cache: starting empty (%s)", reason);
      file.clear();
    }
  }
  VkPipelineCacheCreateInfo info{VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO};
  if (!file.empty()) {
    info.initialDataSize = file.size() - sizeof(FileHeader);
    info.pInitialData = file.data() + sizeof(FileHeader);
  }
  if (vkCreatePipelineCache(device, &info, nullptr, &cache->cache_) != VK_SUCCESS) {
    if (file.empty()) return nullptr;
    LOGW("Vulkan pipeline cache: the driver refused the saved data, starting empty");
    info.initialDataSize = 0;
    info.pInitialData = nullptr;
    if (vkCreatePipelineCache(device, &info, nullptr, &cache->cache_) != VK_SUCCESS) return nullptr;
  } else if (!file.empty()) {
    cache->loadedBytes_ = info.initialDataSize;
    LOGI("Vulkan pipeline cache: loaded %zu B", cache->loadedBytes_);
  }
  cache->savedBytes_ = cache->loadedBytes_;
  return cache;
}

VulkanPipelineCache::~VulkanPipelineCache() {
  if (cache_) vkDestroyPipelineCache(device_, cache_, nullptr);
}

bool VulkanPipelineCache::save() {
  if (path_.empty()) return true;
  size_t size = 0;
  if (vkGetPipelineCacheData(device_, cache_, &size, nullptr) != VK_SUCCESS) return false;
  if (size == savedBytes_) return true;
  std::vector<char> file(sizeof(FileHeader) + size);
  if (vkGetPipelineCacheData(device_, cache_, &size, file.data() + sizeof(FileHeader)) !=
      VK_SUCCESS)
    return false;
  file.resize(sizeof(FileHeader) + size);
  seal(file);
  const std::string temporary = path_ + '.' + std::to_string(getpid()) + '.' +
                                std::to_string(gSaveCount.fetch_add(1)) + kTemporarySuffix;
  std::FILE* out = std::fopen(temporary.c_str(), "wb");
  if (out == nullptr) return false;
  const bool written = std::fwrite(file.data(), 1, file.size(), out) == file.size();
  if (std::fclose(out) != 0 || !written || std::rename(temporary.c_str(), path_.c_str()) != 0) {
    std::remove(temporary.c_str());
    LOGW("Vulkan pipeline cache: could not write %s", path_.c_str());
    return false;
  }
  savedBytes_ = size;
  LOGI("Vulkan pipeline cache: saved %zu B", size);
  return true;
}

}  // namespace splatkit

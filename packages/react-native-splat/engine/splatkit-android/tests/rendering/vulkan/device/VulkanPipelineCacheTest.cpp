#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "rendering/vulkan/device/VulkanPipelineCache.h"
#include "rendering/vulkan/device/VulkanShaderModule.h"
#include "shaders/radix_scan_comp.h"
#include "support/VulkanTestContext.h"

namespace {

using Bytes = std::vector<char>;
namespace test = splatkit::test;
using splatkit::VulkanPipelineCache;
using test::require;

constexpr char kPath[] = "pipeline-cache-test.bin";
// VulkanPipelineCache's file header ahead of the driver's data: magic, version, size, checksum.
constexpr size_t kFileHeaderBytes = 24;
// VkPipelineCacheHeaderVersionOne: headerSize, headerVersion, vendorID, deviceID, then the UUID.
constexpr size_t kUuidOffset = kFileHeaderBytes + 16;
// radix_scan.comp's interface, as VulkanRadixSort declares it.
constexpr uint32_t kScanBindings = 10;
constexpr uint32_t kScanPushBytes = 12;

Bytes readFile(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), {}};
}

void writeFile(const char* path, const Bytes& bytes) {
  std::ofstream out(path, std::ios::binary | std::ios::trunc);
  out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
}

// One pipeline, so the cache holds a compile.
bool buildPipeline(VkDevice device, VkPipelineCache cache) {
  VkPipelineLayoutCreateInfo layoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  VkDescriptorSetLayoutBinding bindings[kScanBindings]{};
  for (uint32_t i = 0; i < kScanBindings; ++i)
    bindings[i] = {i, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
  VkDescriptorSetLayoutCreateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  setInfo.bindingCount = kScanBindings;
  setInfo.pBindings = bindings;
  VkDescriptorSetLayout setLayout = VK_NULL_HANDLE;
  if (vkCreateDescriptorSetLayout(device, &setInfo, nullptr, &setLayout) != VK_SUCCESS)
    return false;
  const VkPushConstantRange push{VK_SHADER_STAGE_COMPUTE_BIT, 0, kScanPushBytes};
  layoutInfo.setLayoutCount = 1;
  layoutInfo.pSetLayouts = &setLayout;
  layoutInfo.pushConstantRangeCount = 1;
  layoutInfo.pPushConstantRanges = &push;
  VkPipelineLayout layout = VK_NULL_HANDLE;
  bool ok = vkCreatePipelineLayout(device, &layoutInfo, nullptr, &layout) == VK_SUCCESS;
  const splatkit::VulkanShaderModule module(device, splatkit::shaders::radix_scan_comp,
                                            splatkit::shaders::radix_scan_comp_size);
  VkPipeline pipeline = VK_NULL_HANDLE;
  if (ok && module) {
    VkComputePipelineCreateInfo info{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    info.stage = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    info.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    info.stage.module = module.get();
    info.stage.pName = "main";
    info.layout = layout;
    ok = vkCreateComputePipelines(device, cache, 1, &info, nullptr, &pipeline) == VK_SUCCESS;
  }
  if (pipeline) vkDestroyPipeline(device, pipeline, nullptr);
  if (layout) vkDestroyPipelineLayout(device, layout, nullptr);
  vkDestroyDescriptorSetLayout(device, setLayout, nullptr);
  return ok && module;
}

std::unique_ptr<VulkanPipelineCache> open(const test::VulkanTestContext& gpu) {
  auto cache =
      VulkanPipelineCache::open(gpu.context->physicalDevice(), gpu.context->device(), kPath);
  require(cache != nullptr, "a pipeline cache opens");
  return cache;
}

// A file that fails a check loads as an empty cache that still compiles.
void requireRejected(const test::VulkanTestContext& gpu, const Bytes& file, const char* message) {
  writeFile(kPath, file);
  auto cache = open(gpu);
  require(cache->loadedBytes() == 0, message);
  require(buildPipeline(gpu.context->device(), cache->handle()), "a rejected cache still compiles");
}

}  // namespace

int main() {
  try {
    test::VulkanTestContext gpu;
    std::remove(kPath);

    {
      auto cache = open(gpu);
      require(cache->loadedBytes() == 0, "no file loads an empty cache");
      require(buildPipeline(gpu.context->device(), cache->handle()), "the cache compiles");
      require(cache->save(), "the cache saves");
    }
    const Bytes saved = readFile(kPath);
    require(saved.size() > kUuidOffset + VK_UUID_SIZE, "the file holds the driver's header");
    std::puts("PASS pipeline cache: saves after a compile");

    {
      auto cache = open(gpu);
      require(cache->loadedBytes() + kFileHeaderBytes == saved.size(),
              "a saved cache loads in full");
      require(buildPipeline(gpu.context->device(), cache->handle()), "a loaded cache compiles");
    }
    std::puts("PASS pipeline cache: reloads its own file");

    requireRejected(gpu, Bytes(saved.begin(), saved.end() - 1), "a truncated file is rejected");
    Bytes flipped = saved;
    flipped.back() = static_cast<char>(flipped.back() ^ 0x40);
    requireRejected(gpu, flipped, "a damaged file is rejected");
    Bytes foreign = saved;
    foreign[kUuidOffset] = static_cast<char>(foreign[kUuidOffset] ^ 0x01);
    VulkanPipelineCache::seal(foreign);
    requireRejected(gpu, foreign, "another device's cache is rejected");
    std::puts("PASS pipeline cache: rejects truncated, damaged and foreign files");

    std::remove(kPath);
    gpu.requireValidationClean();
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL pipeline cache: %s\n", error.what());
    return 1;
  }
}

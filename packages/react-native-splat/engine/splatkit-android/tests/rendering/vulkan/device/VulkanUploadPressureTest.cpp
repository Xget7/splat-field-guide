#include <array>
#include <cstdio>

#include "rendering/vulkan/sort/VulkanRadixSort.h"
#include "support/VulkanTestContext.h"

// No shaders or pipelines: reproduce VulkanRadixSort::reserve's allocation pressure,
// then the first four-byte input upload. Keep the pressure live during readback.
int main(int argc, char** argv) {
  using splatkit::VulkanBuffer;
  using splatkit::test::require;
  std::setvbuf(stdout, nullptr, _IONBF, 0);
  try {
    const bool small = argc == 2 && std::strcmp(argv[1], "--small") == 0;
    require(argc == 1 || small, "usage: splatkit_vulkan_upload_pressure_test [--small]");
    splatkit::test::VulkanTestContext gpu;
    const uint32_t capacity = small ? 262145 : splatkit::VulkanRadixSort::kMaxCapacity;
    std::printf("upload-pressure GPU=%s capacity=%u validation=%s\n",
                gpu.context->deviceDescription().c_str(), capacity,
                gpu.context->validationEnabled() ? "on" : "off");
    VkPhysicalDeviceMemoryProperties memory{};
    vkGetPhysicalDeviceMemoryProperties(gpu.context->physicalDevice(), &memory);
    for (uint32_t i = 0; i < memory.memoryTypeCount; ++i)
      std::printf("memory-type=%u flags=0x%x heap=%u\n", i, memory.memoryTypes[i].propertyFlags,
                  memory.memoryTypes[i].heapIndex);
    constexpr auto kUsage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT;
    std::vector<std::unique_ptr<VulkanBuffer>> pressure;
    const VkDeviceSize pairBytes = VkDeviceSize{capacity} * 4;
    const VkDeviceSize histogramBytes = VkDeviceSize{(capacity + 2047) / 2048} * 1024;
    const std::array<VkDeviceSize, 9> sizes{
        pairBytes, pairBytes, pairBytes, pairBytes, histogramBytes, 1024, 16, 4, 4};
    for (unsigned slot = 0; slot < 2; ++slot) {
      for (auto size : sizes) {
        auto buffer = VulkanBuffer::deviceLocal(*gpu.context, size, kUsage);
        require(static_cast<bool>(buffer), "pressure allocation");
        pressure.push_back(std::move(buffer));
      }
    }
    for (unsigned i = 0; i < 2; ++i) {
      auto buffer = VulkanBuffer::deviceLocal(*gpu.context, pairBytes, kUsage);
      require(static_cast<bool>(buffer), "input allocation");
      pressure.push_back(std::move(buffer));
    }
    auto count = VulkanBuffer::deviceLocal(*gpu.context, 4, kUsage);
    require(static_cast<bool>(count), "count allocation");
    const std::array<uint8_t, 4> countBytes{0x13, 0x57, 0x9b, 0xdf};
    std::puts("upload-pressure stage=first-four-byte-upload (no shader executed)");
    require(count->upload(countBytes.data(), countBytes.size()), "first four-byte upload");
    std::puts("upload-pressure stage=count-readback");
    require(gpu.readback(*count, 4) == std::vector<uint8_t>(countBytes.begin(), countBytes.end()),
            "exact four-byte roundtrip");

    // One full staging window and a partial tail, with 16-byte guards on both sides.
    constexpr size_t kPayloadBytes = 2 * 1024 * 1024 + 28;
    constexpr size_t kGuardBytes = 16;
    std::vector<uint8_t> expected(kPayloadBytes + 2 * kGuardBytes, 0xa5);
    auto destination = VulkanBuffer::deviceLocal(*gpu.context, expected.size(), kUsage);
    require(static_cast<bool>(destination), "guarded allocation");
    std::puts("upload-pressure stage=guarded-window-upload");
    require(destination->upload(expected.data(), expected.size()), "initialize guards");
    for (uint32_t pass = 0; pass < 3; ++pass) {
      uint32_t state = pass + 1;
      for (size_t i = kGuardBytes; i < kGuardBytes + kPayloadBytes; ++i) {
        state = state * 1664525U + 1013904223U;
        expected[i] = static_cast<uint8_t>(state >> 24);
      }
      require(destination->upload(kGuardBytes, expected.data() + kGuardBytes, kPayloadBytes),
              "repeated window upload");
      require(gpu.readback(*destination, expected.size()) == expected,
              "exact payload and untouched guards");
    }
    gpu.requireValidationClean();
    if (small) std::puts("SKIP full-capacity pressure (--small requested)");
    std::puts("PASS upload-pressure: count, repeated payload, both guards; no shaders");
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL upload-pressure: %s\n", error.what());
    return 1;
  }
}

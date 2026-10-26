#include <cstdio>
#include <string>

#include "support/VulkanTestContext.h"

// The capabilities line names what the device reports, so android_perf.py's gpu block
// records the reference phone's real limits.
int main() {
  namespace test = splatkit::test;
  using test::require;
  try {
    test::VulkanTestContext gpu;
    const std::string& capabilities = gpu.context->capabilities();
    std::printf("capabilities: %s\n", capabilities.c_str());

    VkPhysicalDeviceSubgroupProperties subgroup{
        VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES};
    VkPhysicalDeviceProperties2 properties{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
    properties.pNext = &subgroup;
    vkGetPhysicalDeviceProperties2(gpu.context->physicalDevice(), &properties);
    const VkPhysicalDeviceLimits& limits = properties.properties.limits;
    const auto contains = [&](const std::string& part) {
      return capabilities.find(part) != std::string::npos;
    };

    require(contains("subgroup " + std::to_string(subgroup.subgroupSize) + ","),
            "names the subgroup size");
    require(contains("shared memory " + std::to_string(limits.maxComputeSharedMemorySize) + " B"),
            "names the shared memory size");
    require(contains("workgroup invocations " +
                     std::to_string(limits.maxComputeWorkGroupInvocations) + ","),
            "names the workgroup invocations");
    require(contains("storage buffer range " + std::to_string(limits.maxStorageBufferRange) + " B"),
            "names the storage buffer range");
    const bool computeBasic = (subgroup.supportedStages & VK_SHADER_STAGE_COMPUTE_BIT) != 0 &&
                              (subgroup.supportedOperations & VK_SUBGROUP_FEATURE_BASIC_BIT) != 0;
    require(contains("compute subgroup ops basic") == computeBasic,
            "lists basic subgroup operations exactly when compute has them");
    require(contains("float16 arithmetic yes") || contains("float16 arithmetic no"),
            "says whether float16 arithmetic is available");
    require(!contains("device-local heap 0 B"), "finds a device-local heap");
    gpu.requireValidationClean();
    std::puts("PASS context: capabilities");
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL context: %s\n", error.what());
    return 1;
  }
}

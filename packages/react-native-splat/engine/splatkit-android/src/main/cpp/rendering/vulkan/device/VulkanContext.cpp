#include "rendering/vulkan/device/VulkanContext.h"

#include <algorithm>
#include <cstring>
#include <utility>
#include <vector>

#include "splatkit/Log.h"

namespace splatkit {

namespace {

VKAPI_ATTR VkBool32 VKAPI_CALL onValidationMessage(VkDebugUtilsMessageSeverityFlagBitsEXT severity,
                                                   VkDebugUtilsMessageTypeFlagsEXT,
                                                   const VkDebugUtilsMessengerCallbackDataEXT* data,
                                                   void* userData) {
  if (severity & (VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT |
                  VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT)) {
    static_cast<std::atomic<uint32_t>*>(userData)->fetch_add(1, std::memory_order_relaxed);
  }
  if (severity & VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT) {
    LOGE("validation: %s", data->pMessage);
  } else if (severity & VK_DEBUG_UTILS_MESSAGE_SEVERITY_WARNING_BIT_EXT) {
    LOGW("validation: %s", data->pMessage);
  }
  return VK_FALSE;
}

// Debug builds turn the Khronos validation layer on when the app ships it
// (scripts/fetch-validation-layers.sh). Release builds never look for it.
bool wantValidation() {
#ifdef NDEBUG
  return false;
#else
  auto info = vkb::SystemInfo::get_system_info();
  return info && info->validation_layers_available;
#endif
}

bool hasExtension(VkPhysicalDevice gpu, const char* name) {
  uint32_t count = 0;
  vkEnumerateDeviceExtensionProperties(gpu, nullptr, &count, nullptr);
  std::vector<VkExtensionProperties> extensions(count);
  vkEnumerateDeviceExtensionProperties(gpu, nullptr, &count, extensions.data());
  return std::any_of(extensions.begin(), extensions.end(), [&](const VkExtensionProperties& e) {
    return std::strcmp(e.extensionName, name) == 0;
  });
}

std::string subgroupOperations(VkSubgroupFeatureFlags operations) {
  constexpr std::pair<VkSubgroupFeatureFlagBits, const char*> kNames[] = {
      {VK_SUBGROUP_FEATURE_BASIC_BIT, "basic"},
      {VK_SUBGROUP_FEATURE_VOTE_BIT, "vote"},
      {VK_SUBGROUP_FEATURE_ARITHMETIC_BIT, "arithmetic"},
      {VK_SUBGROUP_FEATURE_BALLOT_BIT, "ballot"},
      {VK_SUBGROUP_FEATURE_SHUFFLE_BIT, "shuffle"},
      {VK_SUBGROUP_FEATURE_SHUFFLE_RELATIVE_BIT, "shuffle_relative"},
      {VK_SUBGROUP_FEATURE_CLUSTERED_BIT, "clustered"},
      {VK_SUBGROUP_FEATURE_QUAD_BIT, "quad"}};
  std::string names;
  for (const auto& [bit, name] : kNames) {
    if ((operations & bit) == 0) continue;
    if (!names.empty()) names += ' ';
    names += name;
  }
  return names.empty() ? "none" : names;
}

std::string describeCapabilities(VkPhysicalDevice gpu) {
  VkPhysicalDeviceSubgroupProperties subgroup{
      VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES};
  VkPhysicalDeviceProperties2 properties{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
  properties.pNext = &subgroup;
  vkGetPhysicalDeviceProperties2(gpu, &properties);
  const VkPhysicalDeviceLimits& limits = properties.properties.limits;

  // Core in 1.1; float16 arithmetic needs VK_KHR_shader_float16_int8, which may be absent.
  VkPhysicalDevice16BitStorageFeatures storage16{
      VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_16BIT_STORAGE_FEATURES};
  VkPhysicalDeviceShaderFloat16Int8FeaturesKHR float16{
      VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SHADER_FLOAT16_INT8_FEATURES_KHR};
  const bool float16Extension = hasExtension(gpu, VK_KHR_SHADER_FLOAT16_INT8_EXTENSION_NAME);
  if (float16Extension) storage16.pNext = &float16;
  VkPhysicalDeviceFeatures2 features{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
  features.pNext = &storage16;
  vkGetPhysicalDeviceFeatures2(gpu, &features);

  VkPhysicalDeviceMemoryProperties memory{};
  vkGetPhysicalDeviceMemoryProperties(gpu, &memory);
  VkDeviceSize deviceLocal = 0;
  for (uint32_t i = 0; i < memory.memoryHeapCount; ++i) {
    if (memory.memoryHeaps[i].flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) {
      deviceLocal = std::max(deviceLocal, memory.memoryHeaps[i].size);
    }
  }

  const bool computeSubgroups = (subgroup.supportedStages & VK_SHADER_STAGE_COMPUTE_BIT) != 0;
  const auto yesNo = [](bool value) { return value ? "yes" : "no"; };
  return "subgroup " + std::to_string(subgroup.subgroupSize) + ", compute subgroup ops " +
         (computeSubgroups ? subgroupOperations(subgroup.supportedOperations) : "none") +
         ", shared memory " + std::to_string(limits.maxComputeSharedMemorySize) +
         " B, workgroup invocations " + std::to_string(limits.maxComputeWorkGroupInvocations) +
         ", storage buffer range " + std::to_string(limits.maxStorageBufferRange) +
         " B, device-local heap " + std::to_string(deviceLocal) + " B, float16 arithmetic " +
         yesNo(float16Extension && float16.shaderFloat16 == VK_TRUE) + ", 16-bit storage " +
         yesNo(storage16.storageBuffer16BitAccess == VK_TRUE);
}

}  // namespace

splat::Result<std::unique_ptr<VulkanContext>> VulkanContext::create(std::string pipelineCachePath) {
  std::unique_ptr<VulkanContext> ctx(new VulkanContext());

  const bool validation = wantValidation();
  ctx->validationEnabled_ = validation;
  LOGI("validation layers: %s", validation ? "on" : "off");
  vkb::InstanceBuilder builder;
  builder.set_app_name("SplatKit").set_engine_name("SplatKit").require_api_version(1, 1, 0);
  // Only ask for the debug messenger when the layer that implements it is present.
  // Adreno exposes VK_EXT_debug_utils but fails to create a messenger without the layer,
  // which is why a release build died here while a debug build did not.
  if (validation) {
    builder.request_validation_layers(true)
        .set_debug_callback(onValidationMessage)
        .set_debug_callback_user_data_pointer(&ctx->validationMessageCount_);
  }
  auto instanceResult = builder.build();
  if (!instanceResult) {
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "Vulkan instance: " + instanceResult.error().message()};
  }
  ctx->instance_ = instanceResult.value();

  // The surface comes later (and can come and go), so the device is selected without it.
  // Present support is verified when a surface arrives.
  auto physicalResult = vkb::PhysicalDeviceSelector(ctx->instance_)
                            .set_minimum_version(1, 1)
                            .defer_surface_initialization()
                            .add_required_extension(VK_KHR_SWAPCHAIN_EXTENSION_NAME)
                            .select();
  if (!physicalResult) {
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "no Vulkan 1.1 device: " + physicalResult.error().message()};
  }

  auto deviceResult = vkb::DeviceBuilder(physicalResult.value()).build();
  if (!deviceResult) {
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "Vulkan device: " + deviceResult.error().message()};
  }
  ctx->device_ = deviceResult.value();

  auto queueResult = ctx->device_.get_queue(vkb::QueueType::graphics);
  auto familyResult = ctx->device_.get_queue_index(vkb::QueueType::graphics);
  if (!queueResult || !familyResult) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "no graphics queue"};
  }
  ctx->queue_ = queueResult.value();
  ctx->queueFamily_ = familyResult.value();

  VmaAllocatorCreateInfo allocatorInfo{};
  allocatorInfo.vulkanApiVersion = VK_API_VERSION_1_1;
  allocatorInfo.instance = ctx->instance_.instance;
  allocatorInfo.physicalDevice = ctx->device_.physical_device;
  allocatorInfo.device = ctx->device_.device;
  if (vmaCreateAllocator(&allocatorInfo, &ctx->allocator_) != VK_SUCCESS) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "VMA allocator"};
  }
  ctx->pipelineCache_ = VulkanPipelineCache::open(ctx->device_.physical_device, ctx->device_.device,
                                                  std::move(pipelineCachePath));
  if (!ctx->pipelineCache_) LOGW("Vulkan pipeline cache: unavailable, compiling without one");

  const VkPhysicalDeviceProperties& props = ctx->device_.physical_device.properties;
  LOGI("Vulkan device: %s, API %u.%u.%u, driver 0x%x", props.deviceName,
       VK_VERSION_MAJOR(props.apiVersion), VK_VERSION_MINOR(props.apiVersion),
       VK_VERSION_PATCH(props.apiVersion), props.driverVersion);
  ctx->deviceDescription_ = std::string(props.deviceName) + ", Vulkan " +
                            std::to_string(VK_VERSION_MAJOR(props.apiVersion)) + "." +
                            std::to_string(VK_VERSION_MINOR(props.apiVersion)) + "." +
                            std::to_string(VK_VERSION_PATCH(props.apiVersion));
  ctx->capabilities_ = describeCapabilities(ctx->device_.physical_device);
  LOGI("Vulkan capabilities: %s", ctx->capabilities_.c_str());
  return ctx;
}

VulkanContext::~VulkanContext() {
  // This runs on the failure paths of create() too, where the later handles are still
  // null. vkb::destroy_device dereferences its dispatch table without checking, so every
  // step is guarded here.
  if (device_.device != VK_NULL_HANDLE) {
    vkDeviceWaitIdle(device_.device);
  }
  pipelineCache_.reset();
  if (allocator_ != VK_NULL_HANDLE) {
    vmaDestroyAllocator(allocator_);
  }
  if (device_.device != VK_NULL_HANDLE) {
    vkb::destroy_device(device_);
  }
  if (instance_.instance != VK_NULL_HANDLE) {
    vkb::destroy_instance(instance_);
  }
}

bool VulkanContext::supportsPresent(VkSurfaceKHR surface) const {
  VkBool32 supported = VK_FALSE;
  vkGetPhysicalDeviceSurfaceSupportKHR(physicalDevice(), queueFamily_, surface, &supported);
  return supported == VK_TRUE;
}

void VulkanContext::waitIdle() const {
  vkDeviceWaitIdle(device());
}

}  // namespace splatkit

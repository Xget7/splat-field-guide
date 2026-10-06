#include "rendering/vulkan/VulkanContext.h"

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

// Debug builds turn the Khronos validation layer on when the app ships it.
// Release builds never look for it.
bool wantValidation() {
#ifdef NDEBUG
  return false;
#else
  auto info = vkb::SystemInfo::get_system_info();
  return info && info->validation_layers_available;
#endif
}

}  // namespace

splat::Result<std::unique_ptr<VulkanContext>> VulkanContext::create() {
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

  const VkPhysicalDeviceProperties& props = ctx->device_.physical_device.properties;
  LOGI("Vulkan device: %s, API %u.%u.%u, driver 0x%x", props.deviceName,
       VK_VERSION_MAJOR(props.apiVersion), VK_VERSION_MINOR(props.apiVersion),
       VK_VERSION_PATCH(props.apiVersion), props.driverVersion);
  ctx->deviceDescription_ = std::string(props.deviceName) + ", Vulkan " +
                            std::to_string(VK_VERSION_MAJOR(props.apiVersion)) + "." +
                            std::to_string(VK_VERSION_MINOR(props.apiVersion)) + "." +
                            std::to_string(VK_VERSION_PATCH(props.apiVersion));
  return ctx;
}

VulkanContext::~VulkanContext() {
  // This runs on the failure paths of create() too, where the later handles are still
  // null. vkb::destroy_device dereferences its dispatch table without checking, so every
  // step is guarded here.
  if (device_.device != VK_NULL_HANDLE) {
    vkDeviceWaitIdle(device_.device);
  }
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

#include "splatkit/sfg_vulkan.h"

#include <memory>
#include <string>

#include <android/log.h>
#include "rendering/vulkan/VulkanSplatRenderer.h"
#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/presentation/VulkanFrameLoop.h"
#include "splatkit/Log.h"
#include "splatkit/sfg_platform.h"

namespace {

constexpr char kLogTag[] = "FieldGuideSplat";
constexpr char kPipelineCacheFile[] = "splatkit-vulkan-pipelines.bin";

void androidLog(splatkit::LogLevel level, const char* message) {
  const int priority = level == splatkit::LogLevel::error  ? ANDROID_LOG_ERROR
                       : level == splatkit::LogLevel::warn ? ANDROID_LOG_WARN
                                                           : ANDROID_LOG_INFO;
  __android_log_write(priority, kLogTag, message);
}

// What the renderer borrows. The engine handle releases it after the renderer, and the frame
// loop goes before the device it was made on.
struct VulkanDevice {
  ~VulkanDevice() {
    frameLoop.reset();
    if (ctx) ctx->waitIdle();
  }
  std::unique_ptr<splatkit::VulkanContext> ctx;
  std::unique_ptr<splatkit::VulkanFrameLoop> frameLoop;
};

splatkit::VulkanSplatRenderer& renderer(sfg_engine* engine) {
  return static_cast<splatkit::VulkanSplatRenderer&>(splatkit::engineOf(engine).renderer());
}

}  // namespace

extern "C" {
sfg_engine* sfg_vulkan_create(const char* SFG_NULLABLE cacheDir) {
  splatkit::setLogSink(androidLog);
  auto device = std::make_shared<VulkanDevice>();
  auto ctx = splatkit::VulkanContext::create(
      cacheDir ? std::string(cacheDir) + "/" + kPipelineCacheFile : std::string{});
  if (!ctx) {
    LOGE("Vulkan unavailable: %s", ctx.error().message.c_str());
    return nullptr;
  }
  device->ctx = std::move(ctx.value());
  device->frameLoop = std::make_unique<splatkit::VulkanFrameLoop>(*device->ctx);
  if (!device->frameLoop->valid()) {
    LOGE("Vulkan frame loop unavailable");
    return nullptr;
  }
  auto vulkan = std::make_unique<splatkit::VulkanSplatRenderer>(*device->ctx, *device->frameLoop);
  return splatkit::makeSfgEngine(std::move(vulkan), {}, std::move(device));
}
void sfg_vulkan_set_window(sfg_engine* engine, ANativeWindow* window) {
  renderer(engine).setWindow(window);
}
void sfg_vulkan_resize(sfg_engine* engine, uint32_t width, uint32_t height) {
  renderer(engine).onSurfaceResized(width, height);
}
}

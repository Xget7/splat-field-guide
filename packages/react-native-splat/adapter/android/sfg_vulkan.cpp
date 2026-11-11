#include "sfg/sfg_vulkan.h"

#include <array>
#include <memory>
#include <string>

#include <android/log.h>
#include "splatkit/Log.h"
#include "splatkit/vulkan/VulkanRenderer.h"
#include "sfg/sfg_platform.h"

namespace {

constexpr char kLogTag[] = "FieldGuideSplat";
constexpr char kPipelineCacheFile[] = "splatkit-vulkan-pipelines.bin";

void androidLog(splatkit::LogLevel level, const char* message) {
  const int priority = level == splatkit::LogLevel::error  ? ANDROID_LOG_ERROR
                       : level == splatkit::LogLevel::warn ? ANDROID_LOG_WARN
                                                           : ANDROID_LOG_INFO;
  __android_log_write(priority, kLogTag, message);
}

// Every engine this file hands out was made over a VulkanRenderer.
splatkit::VulkanRenderer& renderer(sfg_engine* engine) {
  return static_cast<splatkit::VulkanRenderer&>(splatkit::engineOf(engine).renderer());
}

}  // namespace

extern "C" {
sfg_engine* sfg_vulkan_create(const char* SFG_NULLABLE cacheDir) {
  splatkit::setLogSink(androidLog);
  auto vulkan = splatkit::VulkanRenderer::create(
      cacheDir ? std::string(cacheDir) + "/" + kPipelineCacheFile : std::string{});
  if (!vulkan) {
    LOGE("Vulkan unavailable: %s", vulkan.error().message.c_str());
    return nullptr;
  }
  auto* engine = splatkit::makeSfgEngine(std::move(vulkan.value()));
  auto policy = splatkit::engineOf(engine).renderPolicy();
  // Preserve the app's black clear colour instead of the SDK's default blue.
  constexpr std::array<double, 3> kBackgroundColor = {0.0, 0.0, 0.0};
  policy.backgroundColor = kBackgroundColor;
  const auto resolution = splatkit::engineOf(engine).setRenderPolicy(policy);
  if (!resolution.accepted) {
    LOGE("Vulkan policy unavailable: %s", resolution.error.c_str());
    sfg_destroy(engine);
    return nullptr;
  }
  return engine;
}
void sfg_vulkan_set_window(sfg_engine* engine, ANativeWindow* window) {
  renderer(engine).setWindow(window);
}
void sfg_vulkan_resize(sfg_engine* engine, uint32_t width, uint32_t height) {
  renderer(engine).onSurfaceResized(width, height);
}
}

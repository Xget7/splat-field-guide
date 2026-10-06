#include "splatkit/sfg_vulkan.h"

#include <android/log.h>
#include "rendering/vulkan/VulkanSplatRenderer.h"
#include "splatkit/Log.h"
#include "splatkit/sfg_platform.h"

namespace {
void androidLog(splatkit::LogLevel level, const char* message) {
  int priority = level == splatkit::LogLevel::error ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
  __android_log_write(priority, "FieldGuideSplat", message);
}
splatkit::VulkanSplatRenderer& renderer(sfg_engine* engine) {
  return static_cast<splatkit::VulkanSplatRenderer&>(splatkit::engineOf(engine).renderer());
}
}

extern "C" {
sfg_engine* sfg_vulkan_create(void) {
  splatkit::setLogSink(androidLog);
  auto vulkan = splatkit::VulkanSplatRenderer::create();
  return vulkan ? splatkit::makeSfgEngine(std::move(vulkan)) : nullptr;
}
void sfg_vulkan_set_window(sfg_engine* engine, ANativeWindow* window) {
  renderer(engine).setWindow(window);
}
void sfg_vulkan_resize(sfg_engine* engine, uint32_t width, uint32_t height) {
  renderer(engine).onSurfaceResized(width, height);
}
}

#import "splatkit/sfg_metal.h"

#import <os/log.h>

#include <memory>
#include <utility>

#include "rendering/MetalSplatRenderer.h"
#include "splatkit/Log.h"
#include "splatkit/sfg_platform.h"

namespace {

// The engine's lines in the unified log, readable in Console and `log stream`.
void osLogSink(splatkit::LogLevel level, const char* message) {
  static os_log_t log = os_log_create("com.fieldguide.splat", "engine");
  const os_log_type_t type = level == splatkit::LogLevel::error  ? OS_LOG_TYPE_ERROR
                             : level == splatkit::LogLevel::warn ? OS_LOG_TYPE_DEFAULT
                                                                 : OS_LOG_TYPE_INFO;
  os_log_with_type(log, type, "%{public}s", message);
}

splatkit::MetalSplatRenderer& metalOf(sfg_engine* engine) {
  return static_cast<splatkit::MetalSplatRenderer&>(splatkit::engineOf(engine).renderer());
}

}  // namespace

extern "C" {

sfg_engine* sfg_metal_create(void) {
  splatkit::setLogSink(&osLogSink);
  auto renderer = splatkit::MetalSplatRenderer::create();
  if (!renderer) return nullptr;
  return splatkit::makeSfgEngine(std::move(renderer));
}

void sfg_metal_set_layer(sfg_engine* engine, CAMetalLayer* layer) {
  metalOf(engine).setLayer(layer);
}

void sfg_metal_set_drawable_size(sfg_engine* engine, uint32_t width, uint32_t height) {
  metalOf(engine).setDrawableSize(width, height);
}

}  // extern "C"

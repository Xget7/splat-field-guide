#pragma once

#include <functional>
#include <memory>
#include <string>

#include <android/native_window.h>

#include "rendering/vulkan/VulkanSplatRenderer.h"
#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/presentation/VulkanFrameLoop.h"
#include "splat/core/Result.h"
#include "splatkit/engine/SplatEngine.h"

namespace splatkit {

// The engine on Android: the Vulkan context and frame loop the renderer needs, the
// renderer, and the shared engine over it. What the JNI holds.
class AndroidEngine {
 public:
  // `cacheDir` is the app's cache directory, where the Vulkan pipeline cache is kept.
  static splat::Result<std::unique_ptr<AndroidEngine>> create(const std::string& cacheDir);
  ~AndroidEngine();

  AndroidEngine(const AndroidEngine&) = delete;
  AndroidEngine& operator=(const AndroidEngine&) = delete;

  SplatEngine& engine() { return *engine_; }
  // The event kind after the shared engine's four, as Kotlin's SplatEngine.Event numbers it.
  static constexpr int kWorldFrameReady = static_cast<int>(SplatEngine::Event::colliderFailed) + 1;
  static_assert(kWorldFrameReady == 4);
  using EventSink = std::function<void(int, const std::string&, uint32_t)>;
  void setEventSink(EventSink sink);
  void render(int64_t frameTimeNanos);
  // A new window (takes a reference) or nullptr when the surface is going away.
  void setWindow(ANativeWindow* window) { renderer_->setWindow(window); }
  // The window changed size while staying attached. Rebuilds the swapchain if needed.
  void onSurfaceResized(uint32_t width, uint32_t height) {
    renderer_->onSurfaceResized(width, height);
  }

 private:
  AndroidEngine() = default;
  void traceBenchmark();

  EventSink eventSink_;
  bool awaitingWorldFrame_ = false;
  uint32_t worldFrameSplatCount_ = 0;
  bool benchmarkTraced_ = false;

  std::unique_ptr<VulkanContext> ctx_;
  std::unique_ptr<VulkanFrameLoop> frameLoop_;
  VulkanSplatRenderer* renderer_ = nullptr;  // owned by the engine
  std::unique_ptr<SplatEngine> engine_;      // last: dies first, with the renderer
};

}  // namespace splatkit

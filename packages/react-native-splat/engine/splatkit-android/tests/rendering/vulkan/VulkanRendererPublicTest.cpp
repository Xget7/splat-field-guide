#include <cstdio>
#include "splatkit/engine/SplatEngine.h"
#include "splatkit/vulkan/VulkanRenderer.h"

int main() {
  constexpr uint32_t kSize = 64;
  auto result = splatkit::VulkanRenderer::create();
  if (!result) {
    std::fprintf(stderr, "%s\n", result.error().message.c_str());
    return 1;
  }
  auto renderer = std::move(result.value());
  auto* surface = renderer.get();
  const splatkit::SplatEngine engine(std::move(renderer));
  // The native test runner has no Android window; exercise the detached lifecycle.
  surface->setWindow(nullptr);
  surface->onSurfaceResized(kSize, kSize);
  return surface->ready() ? 1 : 0;
}

#include "engine/AndroidEventMapping.h"
// Host-only test, built with include paths for splatkit-android/src/main/cpp,
// splatkit-engine/include and splat-core/include. Run without NDEBUG.
#include <cassert>
#include "rendering/vulkan/presentation/VulkanPresentationFailure.h"

#include "rendering/vulkan/presentation/WorldFrameCompletion.h"
#include "splatkit/engine/SplatEngine.h"

static_assert(static_cast<int>(splatkit::SplatEngine::Event::worldReady) == 0);
static_assert(static_cast<int>(splatkit::SplatEngine::Event::worldFailed) == 1);
static_assert(static_cast<int>(splatkit::SplatEngine::Event::colliderReady) == 2);
static_assert(static_cast<int>(splatkit::SplatEngine::Event::colliderFailed) == 3);

int main() {
  assert(!splatkit::terminalPresentationFailure(VK_TIMEOUT));
  assert(!splatkit::terminalPresentationFailure(VK_ERROR_SURFACE_LOST_KHR));
  assert(!splatkit::terminalPresentationFailure(VK_ERROR_OUT_OF_DATE_KHR));
  assert(!splatkit::terminalPresentationFailure(VK_SUBOPTIMAL_KHR));
  assert(splatkit::terminalPresentationFailure(VK_ERROR_DEVICE_LOST));
  splatkit::WorldFrameCompletion completion;
  assert(!completion.completed(0));
  assert(!completion.completed(7));  // a completed debug/previous-world frame
  completion.submitted(8);
  assert(!completion.completed(0));  // submitted, but the GPU is still busy
  assert(!completion.completed(7));
  completion.submitted(9);
  assert(completion.completed(8));  // later submissions do not postpone first-frame readiness
  completion.reset();               // a successful world replacement
  assert(!completion.completed(9));
  completion.submitted(10);
  assert(!completion.completed(9));  // old world's late fence cannot ready the replacement
  assert(completion.completed(10));
  assert(!completion.completed(0));  // device/fence failure never counts as completion

  assert(splatkit::publicEvent(splatkit::SplatEngine::Event::worldReady) == 0);
  assert(splatkit::publicEvent(splatkit::SplatEngine::Event::worldFailed) == 1);
  assert(splatkit::publicEvent(splatkit::SplatEngine::Event::labelsMismatch) == 1);
  assert(splatkit::publicEvent(splatkit::SplatEngine::Event::colliderReady) == 2);
  assert(splatkit::publicEvent(splatkit::SplatEngine::Event::colliderFailed) == 3);
  assert(splatkit::publicEvent(splatkit::SplatEngine::Event::gpuFailed) == 5);
  assert(!splatkit::publicEvent(splatkit::SplatEngine::Event::worldFrameReady));
  constexpr int kUnknownEvent = 999;
  // Exercise unknown values in the scoped enum's fixed int representation.
  // NOLINTNEXTLINE(clang-analyzer-optin.core.EnumCastOutOfRange)
  assert(!splatkit::publicEvent(static_cast<splatkit::SplatEngine::Event>(kUnknownEvent)));
}

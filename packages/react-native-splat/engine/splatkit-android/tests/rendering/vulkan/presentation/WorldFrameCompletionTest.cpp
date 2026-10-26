// Host-only test, built with include paths for splatkit-android/src/main/cpp,
// splatkit-engine/include and splat-core/include. Run without NDEBUG.
#include <cassert>

#include "rendering/vulkan/presentation/WorldFrameCompletion.h"

int main() {
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
}

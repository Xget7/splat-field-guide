// Host-only test, built with an include path for splatkit-android/src/main/cpp.
// Run without NDEBUG.
#include <cassert>

#include "rendering/vulkan/presentation/SurfaceSizeWait.h"

using splatkit::SurfaceSizeWait;
using Size = SurfaceSizeWait::Size;
using Step = SurfaceSizeWait::Step;

namespace {

constexpr Size kPortrait{1080, 2340};
constexpr Size kLandscape{2340, 1080};

void convergesAtOnceWhenTheSurfaceAlreadyReportsTheWindow() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  assert(wait.pending(kPortrait));
  assert(!wait.pending(kLandscape));
  assert(wait.check(kLandscape) == Step::rebuild);
}

void waitsWhileStaleAndRebuildsOnTheFirstMatchingFrame() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  for (int frame = 0; frame < 10; ++frame) assert(wait.check(kPortrait) == Step::wait);
  assert(wait.check(kLandscape) == Step::rebuild);
}

void aFailedQueryCountsAsStale() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  assert(wait.check(std::nullopt) == Step::wait);
  assert(wait.check(kLandscape) == Step::rebuild);
}

void givesUpAfterExactlyTheMaximumStaleFrames() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  for (uint32_t frame = 0; frame < SurfaceSizeWait::kMaxStaleChecks; ++frame) {
    assert(wait.check(kPortrait) == Step::wait);
  }
  assert(wait.check(kPortrait) == Step::giveUp);
  wait.adopt(kPortrait);
  assert(wait.window() == kPortrait);
  assert(!wait.pending(kPortrait));
}

void aMatchOnTheLastWaitingFrameStillRebuilds() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  for (uint32_t frame = 0; frame + 1 < SurfaceSizeWait::kMaxStaleChecks; ++frame) {
    assert(wait.check(kPortrait) == Step::wait);
  }
  assert(wait.check(kLandscape) == Step::rebuild);
}

void theCountRestartsAfterAGiveUp() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  for (uint32_t frame = 0; frame <= SurfaceSizeWait::kMaxStaleChecks; ++frame) {
    wait.check(kPortrait);
  }
  wait.adopt(kPortrait);
  wait.windowResized(kLandscape);
  for (uint32_t frame = 0; frame < SurfaceSizeWait::kMaxStaleChecks; ++frame) {
    assert(wait.check(kPortrait) == Step::wait);
  }
  assert(wait.check(kPortrait) == Step::giveUp);
}

void aMatchResetsTheCount() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  for (uint32_t frame = 0; frame < SurfaceSizeWait::kMaxStaleChecks - 1; ++frame) {
    wait.check(kPortrait);
  }
  assert(wait.check(kLandscape) == Step::rebuild);
  for (uint32_t frame = 0; frame < SurfaceSizeWait::kMaxStaleChecks; ++frame) {
    assert(wait.check(kPortrait) == Step::wait);
  }
  assert(wait.check(kPortrait) == Step::giveUp);
}

void aNewResizeResetsTheCount() {
  SurfaceSizeWait wait;
  wait.windowResized(kLandscape);
  for (uint32_t frame = 0; frame < SurfaceSizeWait::kMaxStaleChecks - 1; ++frame) {
    assert(wait.check(kPortrait) == Step::wait);
  }
  wait.windowResized(kPortrait);
  assert(wait.window() == kPortrait);
  for (uint32_t frame = 0; frame < SurfaceSizeWait::kMaxStaleChecks; ++frame) {
    assert(wait.check(kLandscape) == Step::wait);
  }
  assert(wait.check(kLandscape) == Step::giveUp);
}

}  // namespace

int main() {
  convergesAtOnceWhenTheSurfaceAlreadyReportsTheWindow();
  waitsWhileStaleAndRebuildsOnTheFirstMatchingFrame();
  aFailedQueryCountsAsStale();
  givesUpAfterExactlyTheMaximumStaleFrames();
  aMatchOnTheLastWaitingFrameStillRebuilds();
  theCountRestartsAfterAGiveUp();
  aMatchResetsTheCount();
  aNewResizeResetsTheCount();
}

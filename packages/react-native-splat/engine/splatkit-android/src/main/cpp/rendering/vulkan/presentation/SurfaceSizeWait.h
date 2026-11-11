#pragma once

#include <cstdint>
#include <optional>

namespace splatkit {

// Decides, frame by frame, when a swapchain may be rebuilt for a new window size.
// No Vulkan or Android types, so a host build tests it.
class SurfaceSizeWait {
 public:
  struct Size {
    uint32_t width = 0;
    uint32_t height = 0;
    bool operator==(const Size& other) const {
      return width == other.width && height == other.height;
    }
    bool operator!=(const Size& other) const { return !(*this == other); }
  };

  enum class Step { wait, rebuild, giveUp };

  // Frames to wait for the surface to report the window's size. A surface that never does
  // (a fixed-size buffer) is built at the size it reports instead of redrawing forever.
  static constexpr uint32_t kMaxStaleChecks = 60;

  // The window now has this size and the swapchain must reach it; starts a new wait.
  void windowResized(Size window) {
    window_ = window;
    staleChecks_ = 0;
  }
  Size window() const { return window_; }
  // True while the swapchain is not the window's size.
  bool pending(Size swapchain) const { return swapchain != window_; }

  // One frame's decision. `reported` is the size the surface reports, empty when the query
  // failed, which counts as stale. `rebuild` and `giveUp` both restart the count; after a
  // `giveUp` rebuild the caller passes the swapchain it got to `adopt`.
  Step check(std::optional<Size> reported) {
    if (reported && *reported == window_) {
      staleChecks_ = 0;
      return Step::rebuild;
    }
    if (++staleChecks_ <= kMaxStaleChecks) return Step::wait;
    staleChecks_ = 0;
    return Step::giveUp;
  }
  // The swapchain size the surface settled on, taken as the window's size from here on.
  void adopt(Size swapchain) { window_ = swapchain; }

 private:
  Size window_;
  uint32_t staleChecks_ = 0;
};

}  // namespace splatkit

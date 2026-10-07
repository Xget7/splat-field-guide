#pragma once

#include <bitset>
#include <cstddef>
#include <cstdint>

#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {

// Per-label styles ease between highlights; callers must serialize access.
class Highlight {
 public:
  // Empty labels restore captured styles, unselected labels dim, and repeated targets preserve the
  // current fade.
  void set(const std::uint8_t* labels, std::size_t count);

  // Returns whether styles changed.
  bool update(float dtSeconds);
  bool fading() const { return elapsed_ < kFadeSeconds; }

  const LabelStyles& styles() const { return current_; }

  static constexpr float kFadeSeconds = 0.25f;
  // #2BB8CC, the app's accent.
  static constexpr float kTint[3] = {0x2B / 255.0f, 0xB8 / 255.0f, 0xCC / 255.0f};
  // A faint tint preserves the part's captured colours.
  static constexpr float kTintAmount = 0.12f;
  // Lift brightness so parts captured under a bonnet remain visible.
  static constexpr float kEmphasisBrightness = 1.15f;
  // Keep dimmed surroundings visible for context.
  static constexpr float kDimBrightness = 0.55f;

 private:
  std::bitset<kLabelCount> parts_;
  LabelStyles from_{};
  LabelStyles to_{};
  LabelStyles current_{};
  float elapsed_ = kFadeSeconds;
};

}

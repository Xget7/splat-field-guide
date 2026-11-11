#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "splatkit/labels/LabelStyles.h"

namespace splatkit {

// Per-label styles ease between highlights; callers must serialize access.
class Highlight {
 public:
  explicit Highlight(std::size_t labelCount = 0) : current_(labelCount) {}
  // Empty labels restore captured styles, unselected labels dim, and repeated targets preserve the
  // current fade.
  // A changed target starts from the currently resolved appearance.
  void set(const std::uint16_t* labels, std::size_t count);

  // Returns whether styles changed.
  bool update(float dtSeconds);
  bool fading() const { return elapsed_ < kFadeSeconds; }

  const LabelStyles& styles() const { return current_; }

  static constexpr float kFadeSeconds = 0.25f;
  // Default cyan tint.
  static constexpr float kTint[3] = {0x2B / 255.0f, 0xB8 / 255.0f, 0xCC / 255.0f};
  // A faint tint preserves the part's captured colours.
  static constexpr float kTintAmount = 0.12f;
  // Lift dim captured colours.
  static constexpr float kEmphasisBrightness = 1.15f;
  // Keep dimmed surroundings visible for context.
  static constexpr float kDimBrightness = 0.55f;

 private:
  void completeTransition();
  std::vector<std::uint16_t> parts_;
  LabelStyles current_;
  std::array<LabelStyle, kStyleStates> from_{}, to_{};
  bool warnedInvalid_ = false;
  float elapsed_ = kFadeSeconds;
};

}  // namespace splatkit

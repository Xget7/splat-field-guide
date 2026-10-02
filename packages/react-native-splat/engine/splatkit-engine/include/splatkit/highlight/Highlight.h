#pragma once

#include <bitset>
#include <cstddef>
#include <cstdint>

#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {

// The highlight as the GPU draws it: a style for every part label, eased from the
// previous highlight to the newest so a change reads as a transition rather than a cut.
// Not thread safe.
class Highlight {
 public:
  // Emphasises the parts with `labels`, lifted and faintly blue, and dims every other splat,
  // the unlabelled ones included. No labels draws every splat as captured. The parts it already
  // shows or heads for change nothing, so a caller may send them again.
  void set(const std::uint8_t* labels, std::size_t count);

  // Advances the fade by `dtSeconds`. True when the styles changed.
  bool update(float dtSeconds);
  bool fading() const { return elapsed_ < kFadeSeconds; }

  const LabelStyles& styles() const { return current_; }

  static constexpr float kFadeSeconds = 0.25f;
  // #0A6CFF, the app's accent.
  static constexpr float kTint[3] = {0x0A / 255.0f, 0x6C / 255.0f, 0xFF / 255.0f};
  // Faint, so a part keeps its true colours: the marker around it says which one it is.
  static constexpr float kTintAmount = 0.12f;
  // A capture in the shade of a bonnet reads dark; the part shown is lifted a little.
  static constexpr float kEmphasisBrightness = 1.15f;
  // Dim enough for the part to stand out, bright enough that the bay around it still reads.
  static constexpr float kDimBrightness = 0.55f;

 private:
  std::bitset<kLabelCount> parts_;
  LabelStyles from_{};
  LabelStyles to_{};
  LabelStyles current_{};
  float elapsed_ = kFadeSeconds;
};

}  // namespace splatkit

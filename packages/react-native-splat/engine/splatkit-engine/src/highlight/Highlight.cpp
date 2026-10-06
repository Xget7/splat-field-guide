#include "splatkit/highlight/Highlight.h"

#include <algorithm>

namespace splatkit {
namespace {

float mix(float a, float b, float t) {
  return a + (b - a) * t;
}

float smoothstep(float t) {
  return t * t * (3 - 2 * t);
}

LabelStyle emphasised() {
  LabelStyle style;
  std::copy(std::begin(Highlight::kTint), std::end(Highlight::kTint), style.tint);
  style.tintAmount = Highlight::kTintAmount;
  style.brightness = Highlight::kEmphasisBrightness;
  return style;
}

LabelStyle dimmed() {
  LabelStyle style;
  style.brightness = Highlight::kDimBrightness;
  return style;
}

}

void Highlight::set(const std::uint8_t* labels, std::size_t count) {
  std::bitset<kLabelCount> parts;
  for (std::size_t i = 0; labels != nullptr && i < count; ++i) parts.set(labels[i]);
  if (parts == parts_) return;
  parts_ = parts;
  from_ = current_;
  if (parts.none()) {
    to_.fill(LabelStyle{});
  } else {
    for (std::size_t label = 0; label < kLabelCount; ++label) {
      to_[label] = parts.test(label) ? emphasised() : dimmed();
    }
  }
  elapsed_ = 0;
}

bool Highlight::update(float dtSeconds) {
  if (!fading()) return false;
  elapsed_ = std::min(elapsed_ + std::max(dtSeconds, 0.0f), kFadeSeconds);
  const float t = smoothstep(elapsed_ / kFadeSeconds);
  for (std::size_t label = 0; label < kLabelCount; ++label) {
    const LabelStyle& a = from_[label];
    const LabelStyle& b = to_[label];
    LabelStyle& out = current_[label];
    // A tint fades in and out in place, so a part going dark never flashes another colour.
    const bool tinted = b.tintAmount > 0;
    for (int c = 0; c < 3; ++c) out.tint[c] = tinted ? b.tint[c] : a.tint[c];
    out.tintAmount = mix(a.tintAmount, b.tintAmount, t);
    out.brightness = mix(a.brightness, b.brightness, t);
    out.opacity = mix(a.opacity, b.opacity, t);
  }
  return true;
}

}

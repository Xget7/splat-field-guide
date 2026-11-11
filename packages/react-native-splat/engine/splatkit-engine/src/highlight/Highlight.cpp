#include "splatkit/highlight/Highlight.h"

#include <algorithm>
#include "splatkit/Log.h"

namespace splatkit {
namespace {

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

std::vector<uint16_t> validParts(const uint16_t* labels, std::size_t count, std::size_t labelCount,
                                 bool& warned) {
  std::vector<std::uint16_t> parts;
  for (std::size_t i = 0; labels && i < count; ++i) {
    if (labels[i] < labelCount)
      parts.push_back(labels[i]);
    else if (!warned) {
      LOGW("Highlight label outside world label count");
      warned = true;
    }
  }
  std::sort(parts.begin(), parts.end());
  parts.erase(std::unique(parts.begin(), parts.end()), parts.end());
  return parts;
}

}  // namespace

void Highlight::set(const std::uint16_t* labels, std::size_t count) {
  if (current_.states().empty()) return;
  auto parts = validParts(labels, count, current_.states().size(), warnedInvalid_);
  if (parts == parts_) return;
  const std::array<LabelStyle, 3> looks = {LabelStyle{}, emphasised(), dimmed()};
  auto states = current_.states();
  std::array<LabelStyle, kStyleStates> starts{};
  std::array<LabelStyle, kStyleStates> targets{};
  std::array<uint32_t, kStyleStates * 3> mapping{};
  mapping.fill(kStyleStates);
  std::size_t used = 0;
  for (std::size_t label = 0; label < states.size(); ++label) {
    const auto old = states[label];
    const std::size_t target =
        parts.empty() ? 0 : (std::binary_search(parts.begin(), parts.end(), label) ? 1 : 2);
    auto& state = mapping[old * 3 + target];
    if (state == kStyleStates) {
      if (used == kStyleStates) {
        completeTransition();
        set(labels, count);
        return;
      }
      state = static_cast<uint32_t>(used++);
      starts[state] = current_.palette()[old];
      targets[state] = looks[target];
      // Tint has no visible contribution at zero amount; keep the coloured endpoint's hue.
      if (starts[state].tintAmount == 0) std::copy_n(targets[state].tint, 3, starts[state].tint);
      if (targets[state].tintAmount == 0) std::copy_n(starts[state].tint, 3, targets[state].tint);
    }
    states[label] = state;
  }
  parts_ = std::move(parts);
  from_ = starts;
  to_ = targets;
  current_.setStates(std::move(states));
  current_.setPalette(from_);
  elapsed_ = 0;
}

void Highlight::completeTransition() {
  // Bound palette storage under repeated retargeting by completing the oldest fade.
  auto completed = current_.states();
  for (auto& value : completed) {
    const auto& look = to_[value];
    value = look.tintAmount > 0 ? 1 : (look.brightness < 1 ? 2 : 0);
  }
  std::array<LabelStyle, kStyleStates> palette{};
  palette[1] = emphasised();
  palette[2] = dimmed();
  current_.setStates(std::move(completed));
  current_.setPalette(palette);
  elapsed_ = kFadeSeconds;
}

bool Highlight::update(float dtSeconds) {
  if (!fading()) return false;
  elapsed_ = std::min(elapsed_ + std::max(dtSeconds, 0.0f), kFadeSeconds);
  const float fade = smoothstep(elapsed_ / kFadeSeconds);
  auto palette = from_;
  for (std::size_t i = 0; i < kStyleStates; ++i) {
    auto& a = palette[i];
    const auto& b = to_[i];
    for (int c = 0; c < 3; ++c) a.tint[c] += (b.tint[c] - a.tint[c]) * fade;
    a.tintAmount += (b.tintAmount - a.tintAmount) * fade;
    a.brightness += (b.brightness - a.brightness) * fade;
    a.opacity += (b.opacity - a.opacity) * fade;
  }
  current_.setPalette(palette);
  return true;
}

}  // namespace splatkit

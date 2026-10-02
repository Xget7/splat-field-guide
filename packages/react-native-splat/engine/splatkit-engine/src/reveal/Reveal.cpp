#include "splatkit/reveal/Reveal.h"

#include <algorithm>
#include <cmath>

namespace splatkit {
namespace {

// Eases in and out, so the sweep starts and lands softly.
float smootherstep(float t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

}  // namespace

void Reveal::start(const splat::Bounds& bounds, float seconds) {
  const float height = bounds.max[1] - bounds.min[1];
  elapsed_ = 0;
  if (!std::isfinite(height) || height <= 0 || !std::isfinite(seconds) || seconds <= 0) {
    seconds_ = 0;
    return;
  }
  seconds_ = seconds;
  band_ = height * kBandShare;
  // The band starts wholly below the world and ends wholly above it, so the first frame
  // draws nothing and the last draws every splat as captured.
  bottom_ = bounds.min[1] - band_;
  top_ = bounds.max[1] + band_;
}

bool Reveal::update(float dtSeconds) {
  if (!active()) return false;
  elapsed_ = std::min(elapsed_ + std::max(dtSeconds, 0.0f), seconds_);
  return true;
}

float Reveal::level() const {
  if (!active()) return std::numeric_limits<float>::infinity();
  return bottom_ + (top_ - bottom_) * smootherstep(elapsed_ / seconds_);
}

}  // namespace splatkit

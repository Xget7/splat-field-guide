#include "splatkit/reveal/Reveal.h"

#include <algorithm>
#include <cmath>

namespace splatkit {
namespace {

float smootherstep(float t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

}

void Reveal::start(const splat::Bounds& bounds, float seconds) {
  const float height = bounds.max[1] - bounds.min[1];
  elapsed_ = 0;
  if (!std::isfinite(height) || height <= 0 || !std::isfinite(seconds) || seconds <= 0) {
    seconds_ = 0;
    return;
  }
  seconds_ = seconds;
  band_ = height * kBandShare;
  // Start and end the band outside the bounds so the first frame hides everything and the last
  // restores captured styles.
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

}

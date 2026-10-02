#pragma once

#include <limits>

#include "splat/formats/SplatCloud.h"

namespace splatkit {

// A new world materialises rather than appearing at once: a level rises through it from the
// bottom up, nothing above the level is drawn yet, and a thin band just under it glows in
// the accent, like a scanner passing over the capture. Not thread safe.
class Reveal {
 public:
  // Sweeps over `bounds` in `seconds`, from just below them to just above. +Y is up. No
  // time, or no height, shows the world at once.
  void start(const splat::Bounds& bounds, float seconds);

  // Advances the sweep by `dtSeconds`. True when the level moved.
  bool update(float dtSeconds);
  bool active() const { return elapsed_ < seconds_; }

  // World height above which nothing is drawn yet; infinite once the sweep is over.
  float level() const;
  // Height of the glowing band under the level; zero once the sweep is over.
  float band() const { return active() ? band_ : 0.0f; }

  // The band's share of the world's height: a line, not a wash.
  static constexpr float kBandShare = 0.08f;

 private:
  float bottom_ = 0;
  float top_ = 0;
  float band_ = 0;
  float seconds_ = 0;
  float elapsed_ = 0;
};

}  // namespace splatkit

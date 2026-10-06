#pragma once

#include <limits>

#include "splat/formats/SplatCloud.h"

namespace splatkit {

// The sweep clips above a rising level and glows just below it; callers must serialize access.
class Reveal {
 public:
  // The sweep rises along +Y; zero duration or height shows the world immediately.
  void start(const splat::Bounds& bounds, float seconds);

  // Returns whether the reveal level moved.
  bool update(float dtSeconds);
  bool active() const { return elapsed_ < seconds_; }

  // World height above which nothing is drawn yet; infinite once the sweep is over.
  float level() const;
  // Height of the glowing band under the level; zero once the sweep is over.
  float band() const { return active() ? band_ : 0.0f; }

  static constexpr float kBandShare = 0.08f;

 private:
  float bottom_ = 0;
  float top_ = 0;
  float band_ = 0;
  float seconds_ = 0;
  float elapsed_ = 0;
};

}

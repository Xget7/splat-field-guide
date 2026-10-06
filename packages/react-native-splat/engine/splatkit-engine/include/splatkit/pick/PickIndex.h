#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include "splat/formats/SplatCloud.h"
#include "splat/math/Vec3.h"

namespace splatkit {

// A ray in world space. `direction` is a unit vector.
struct Ray {
  splat::Vec3 origin;
  splat::Vec3 direction;
};

// Immutable picks composite nearest-first within three sigma and return the strongest label,
// allowing faint foreground and opaque unlabelled occluders.
class PickIndex {
 public:
  // Takes positions, covariances, opacities and labels from cloud; colours and harmonics remain,
  // and missing labels pick nothing.
  static std::shared_ptr<const PickIndex> take(splat::SplatCloud& cloud);

  // The label the ray shows, or 0 for an unlabelled part or less than half a covered pixel.
  std::uint8_t pick(const Ray& ray) const;

  static constexpr float kSigmaCutoff = 3.0f;
  static constexpr float kMinAlpha = 1.0f / 255.0f;
  static constexpr float kMinCoverage = 0.5f;

 private:
  PickIndex() = default;

  std::vector<float> positions_;
  std::vector<float> covariances_;
  std::vector<float> alphas_;
  std::vector<std::uint8_t> labels_;
};

}

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

// Answers which part a view ray shows. It composites the Gaussians the ray passes within
// three sigma of, nearest centre first as the renderer does, and returns the label that
// contributes most to that pixel: a faint splat in front does not hide the part behind it,
// and an unlabelled one that covers it does. Immutable, so any thread may pick.
class PickIndex {
 public:
  // Takes the positions, covariances, opacities and labels out of `cloud`, which keeps its
  // colours and harmonics. A cloud without labels picks nothing.
  static std::shared_ptr<const PickIndex> take(splat::SplatCloud& cloud);

  // The label the ray shows, or 0 for an unlabelled part or less than half a covered pixel.
  std::uint8_t pick(const Ray& ray) const;

  // Where the ray stops mattering, and what counts as a hit.
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

}  // namespace splatkit

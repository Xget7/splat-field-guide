#include "splatkit/pick/PickIndex.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace splatkit {
namespace {

constexpr std::size_t kCovarianceFloats = 6;  // xx, xy, xz, yy, yz, zz
constexpr std::size_t kLabelCount = 256;
constexpr float kCutoffSquared = PickIndex::kSigmaCutoff * PickIndex::kSigmaCutoff;
// Past this transmittance nothing behind can change which label wins.
constexpr float kOpaque = PickIndex::kMinAlpha;

struct Hit {
  float depthSquared;
  float alpha;
  std::uint8_t label;
};

// The squared Mahalanobis distance from the Gaussian's centre to the ray, minimised over the
// ray: with A the inverse covariance and v from the centre to the origin, it is
// v.A.v - (d.A.v)^2 / d.A.d. False when the covariance is degenerate.
bool rayDistanceSquared(const float* c, splat::Vec3 v, splat::Vec3 d, float* out) {
  const float xx = c[0], xy = c[1], xz = c[2], yy = c[3], yz = c[4], zz = c[5];
  // The adjugate; its product with a vector over the determinant applies the inverse.
  const float axx = yy * zz - yz * yz, axy = xz * yz - xy * zz, axz = xy * yz - xz * yy;
  const float ayy = xx * zz - xz * xz, ayz = xy * xz - xx * yz, azz = xx * yy - xy * xy;
  const float det = xx * axx + xy * axy + xz * axz;
  if (!(det > 0)) return false;
  const auto apply = [&](splat::Vec3 u) -> splat::Vec3 {
    return {axx * u.x + axy * u.y + axz * u.z, axy * u.x + ayy * u.y + ayz * u.z,
            axz * u.x + ayz * u.y + azz * u.z};
  };
  const splat::Vec3 av = apply(v);
  const float dad = splat::dot(d, apply(d));
  if (!(dad > 0)) return false;
  const float dav = splat::dot(d, av);
  *out = std::max(0.0f, (splat::dot(v, av) - dav * dav / dad) / det);
  return true;
}

}  // namespace

std::shared_ptr<const PickIndex> PickIndex::take(splat::SplatCloud& cloud) {
  std::shared_ptr<PickIndex> index(new PickIndex());
  if (cloud.labels.empty()) return index;
  index->positions_ = std::move(cloud.positions);
  index->covariances_ = std::move(cloud.covariances);
  index->alphas_ = std::move(cloud.alphas);
  index->labels_ = std::move(cloud.labels);
  return index;
}

std::uint8_t PickIndex::pick(const Ray& ray) const {
  std::vector<Hit> hits;
  const splat::Vec3 o = ray.origin;
  const splat::Vec3 d = ray.direction;
  for (std::size_t i = 0; i < labels_.size(); ++i) {
    const float* p = &positions_[i * 3];
    const float* c = &covariances_[i * kCovarianceFloats];
    const splat::Vec3 v{o.x - p[0], o.y - p[1], o.z - p[2]};
    const float along = -splat::dot(v, d);  // the centre's distance along the ray
    if (along <= 0) continue;
    // The trace bounds the largest variance, so this sphere holds the three-sigma ellipsoid.
    const float reachSquared = kCutoffSquared * (c[0] + c[3] + c[5]);
    if (splat::dot(v, v) - along * along > reachSquared) continue;
    float distanceSquared = 0;
    if (!rayDistanceSquared(c, v, d, &distanceSquared) || distanceSquared > kCutoffSquared) {
      continue;
    }
    const float alpha = alphas_[i] * std::exp(-0.5f * distanceSquared);
    if (alpha < kMinAlpha) continue;
    hits.push_back({splat::dot(v, v), alpha, labels_[i]});
  }
  std::sort(hits.begin(), hits.end(),
            [](const Hit& a, const Hit& b) { return a.depthSquared < b.depthSquared; });

  std::array<float, kLabelCount> weights{};
  float transmittance = 1;
  for (const Hit& hit : hits) {
    weights[hit.label] += hit.alpha * transmittance;
    transmittance *= 1 - hit.alpha;
    if (transmittance < kOpaque) break;
  }
  if (1 - transmittance < kMinCoverage) return 0;
  return static_cast<std::uint8_t>(std::max_element(weights.begin(), weights.end()) -
                                   weights.begin());
}

}  // namespace splatkit

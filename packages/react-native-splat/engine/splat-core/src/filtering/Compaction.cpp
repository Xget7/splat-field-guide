#include "splat/filtering/Compaction.h"

#include <algorithm>

namespace splat {
namespace {

template <typename T>
void keepOnly(std::vector<T>& values, std::size_t stride, const std::vector<bool>& keep) {
  if (values.empty()) return;
  std::size_t kept = 0;
  for (std::size_t i = 0; i < keep.size(); ++i) {
    if (!keep[i]) continue;
    if (kept != i) {
      std::copy_n(&values[i * stride], stride, &values[kept * stride]);
    }
    ++kept;
  }
  values.resize(kept * stride);
}

}

void keepSplats(SplatCloud& cloud, const std::vector<bool>& keep) {
  const std::size_t n = cloud.count();
  if (n == 0) return;
  const std::size_t harmonics = cloud.sh.size() / n;
  keepOnly(cloud.positions, 3, keep);
  keepOnly(cloud.covariances, 6, keep);
  keepOnly(cloud.colors, 3, keep);
  keepOnly(cloud.alphas, 1, keep);
  keepOnly(cloud.sh, harmonics, keep);
  keepOnly(cloud.labels, 1, keep);
}

}

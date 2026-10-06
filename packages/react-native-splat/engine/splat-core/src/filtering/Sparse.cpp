#include "splat/filtering/Sparse.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

#include "splat/filtering/Compaction.h"

namespace splat {
namespace {

using Cells = std::array<std::size_t, 3>;

struct Grid {
  std::array<float, 3> origin{0, 0, 0};
  float cell = kSparseCell;
  Cells dims{1, 1, 1};

  std::size_t cellCount() const { return dims[0] * dims[1] * dims[2]; }

  std::size_t indexOf(const float* position) const {
    Cells at;
    for (int k = 0; k < 3; ++k) {
      // Clamped in float first: a position at the far edge may round to one cell past it.
      const float along = std::clamp((position[k] - origin[k]) / cell, 0.0f,
                                     static_cast<float>(dims[k] - 1));
      at[k] = static_cast<std::size_t>(along);
    }
    return (at[2] * dims[1] + at[1]) * dims[0] + at[0];
  }
};

// Flat axes use one cell so degenerate bounds remain filterable.
bool fitGrid(const SplatCloud& cloud, Grid& grid) {
  std::array<float, 3> low = {cloud.positions[0], cloud.positions[1], cloud.positions[2]};
  std::array<float, 3> high = low;
  for (std::size_t i = 3; i < cloud.positions.size(); ++i) {
    const int k = static_cast<int>(i % 3);
    low[k] = std::min(low[k], cloud.positions[i]);
    high[k] = std::max(high[k], cloud.positions[i]);
  }
  std::array<float, 3> extent;
  for (int k = 0; k < 3; ++k) {
    extent[k] = high[k] - low[k];
    if (!std::isfinite(extent[k])) return false;
  }
  grid.origin = low;
  // Compute grid size in double to avoid overflow while growing cells to fit the memory limit.
  grid.cell = kSparseCell;
  for (;;) {
    double cellCount = 1;
    for (int k = 0; k < 3; ++k) {
      cellCount *= std::floor(static_cast<double>(extent[k]) / grid.cell) + 1;
    }
    if (cellCount <= static_cast<double>(kSparseMaxCells)) break;
    grid.cell *= 1.1f;
  }
  for (int k = 0; k < 3; ++k) {
    grid.dims[k] = static_cast<std::size_t>(std::floor(static_cast<double>(extent[k]) / grid.cell)) + 1;
  }
  return true;
}

// One neighbour-sum pass per axis produces the 3x3x3 opacity sum.
void sumAlongAxis(std::vector<float>& cells, std::size_t length, std::size_t stride,
                  std::vector<float>& line) {
  if (length < 2) return;
  const std::size_t count = cells.size();
  // A line starts wherever the previous value along the axis would fall outside the grid.
  const std::size_t block = length * stride;
  for (std::size_t base = 0; base < count; base += block) {
    for (std::size_t offset = 0; offset < stride; ++offset) {
      float* first = &cells[base + offset];
      for (std::size_t j = 0; j < length; ++j) line[j] = first[j * stride];
      for (std::size_t j = 0; j < length; ++j) {
        const float before = j > 0 ? line[j - 1] : 0.0f;
        const float after = j + 1 < length ? line[j + 1] : 0.0f;
        first[j * stride] = before + line[j] + after;
      }
    }
  }
}

}

std::size_t removeSparse(SplatCloud& cloud) {
  const std::size_t n = cloud.count();
  if (n < kSparseMinSplats) return 0;
  Grid grid;
  if (!fitGrid(cloud, grid)) return 0;
  std::vector<float> cells(grid.cellCount(), 0.0f);
  for (std::size_t i = 0; i < n; ++i) {
    cells[grid.indexOf(&cloud.positions[i * 3])] += cloud.alphas[i];
  }
  std::vector<float> line(*std::max_element(grid.dims.begin(), grid.dims.end()));
  sumAlongAxis(cells, grid.dims[0], 1, line);
  sumAlongAxis(cells, grid.dims[1], grid.dims[0], line);
  sumAlongAxis(cells, grid.dims[2], grid.dims[0] * grid.dims[1], line);

  // A cloud without labels has no parts, so all of it is open to removal.
  const bool labelled = !cloud.labels.empty();
  std::vector<bool> keep(n);
  std::size_t removed = 0;
  for (std::size_t i = 0; i < n; ++i) {
    const bool part = labelled && cloud.labels[i] != 0;
    keep[i] = part || cells[grid.indexOf(&cloud.positions[i * 3])] >= kSparseAlpha;
    removed += keep[i] ? 0 : 1;
  }
  if (removed == 0) return 0;
  keepSplats(cloud, keep);
  return removed;
}

}

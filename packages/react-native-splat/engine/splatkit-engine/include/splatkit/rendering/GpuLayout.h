#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "splat/formats/SplatCloud.h"

namespace splatkit {

// The shared 32-byte record minimizes vertex bandwidth using source colour precision and half-float
// covariances.
struct GpuSplat {
  float position[3];
  uint32_t rgba8;     // colour and alpha, a real uint: never routed through a float, whose
                      // NaN patterns some mobile compilers canonicalise
  uint32_t cov[3];    // six halves: (xx, xy), (xz, yy), (yz, zz)
  uint32_t partLabel;  // 0 for none
};
static_assert(sizeof(GpuSplat) == 32, "GpuSplat must match the shader struct");

struct LabelStyle {
  float tint[3] = {0, 0, 0};
  float tintAmount = 0;
  float brightness = 1;
  float opacity = 1;
  float reserved[2] = {0, 0};
};
static_assert(sizeof(LabelStyle) == 32, "LabelStyle must match the shader struct");

constexpr std::size_t kLabelCount = 256;
using LabelStyles = std::array<LabelStyle, kLabelCount>;

// SH bands 1 to degree pack channel-first halves, two per uint, with each splat uint-aligned.
std::size_t shStride(int degree);

bool carriesSh(const splat::SplatCloud& cloud, int degree);

// The cloud must carry the requested SH degree; each splat uses shStride(degree) uints.
std::vector<uint32_t> packSh(const splat::SplatCloud& cloud, int degree);

std::vector<GpuSplat> packSplats(const splat::SplatCloud& cloud);
// Callers validate range and capacity for bounded staging.
void packSplatRange(const splat::SplatCloud& cloud, size_t offset, size_t count, GpuSplat* out);
void packShRange(const splat::SplatCloud& cloud, int degree, size_t offset, size_t count,
                 uint32_t* out);

}

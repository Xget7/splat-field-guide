#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>
#include <memory>

#include "splat/formats/SplatCloud.h"

// Field Guide's per-splat part labels and per-part styles, kept beside the upstream GpuSplat
// record so the record stays 32 bytes and byte-identical to SplatKit's. Only the visibility pass
// reads them, and it bakes the styled colour and opacity into the projected splat.

namespace splatkit {

// How one part is drawn: the captured colour mixed toward a tint, scaled in brightness and
// opacity. The default draws the part as captured.
struct LabelStyle {
  float tint[3] = {0, 0, 0};
  float tintAmount = 0;
  float brightness = 1;
  float opacity = 1;
  float reserved[2] = {0, 0};
};
static_assert(sizeof(LabelStyle) == 32, "LabelStyle must match the shader struct");

// One style per value an unsigned 16-bit part label can take.
constexpr std::size_t kLabelCount = 65536;
struct LabelStyles : std::vector<LabelStyle> {
  LabelStyles() : std::vector<LabelStyle>(kLabelCount) {}
  void fill(const LabelStyle& style) { std::fill(begin(), end(), style); }
};

// The visibility pass's guide data for one frame. The reveal clips splats above reveal[0] and
// glows within reveal[1] below it; the pad keeps the styles 16-byte aligned for both APIs.
struct GuideUniform {
  float reveal[2];
  float pad[2];
  LabelStyle styles[kLabelCount];
};
// Storage buffer lookup preserves per-label fades across the complete uint16 range.
static_assert(sizeof(GuideUniform) == 2097168, "GuideUniform must match the shader struct");

// Null styles draw every part as captured.
std::unique_ptr<GuideUniform> makeGuideUniform(const LabelStyles* styles, float revealLevel, float revealBand);

// The label stream: two bytes per splat, halfword i of the little-endian words being splat i's label,
// padded with zeros to whole words. Vulkan 1.1 does not guarantee 16-bit storage, so both APIs
// read the same words. A cloud without labels packs zeros, so every splat takes style 0.
std::vector<uint32_t> packLabels(const splat::SplatCloud& cloud);

}  // namespace splatkit

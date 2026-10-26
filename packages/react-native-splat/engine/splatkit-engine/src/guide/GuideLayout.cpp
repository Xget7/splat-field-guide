#include "splatkit/guide/GuideLayout.h"

#include <algorithm>

namespace splatkit {
namespace {

constexpr std::size_t kLabelsPerWord = sizeof(uint32_t);
constexpr uint32_t kBitsPerLabel = 8;

}  // namespace

GuideUniform makeGuideUniform(const LabelStyles* styles, float revealLevel, float revealBand) {
  // Value initialisation gives every style its as-captured defaults and zeroes the pad.
  GuideUniform guide{};
  guide.reveal[0] = revealLevel;
  guide.reveal[1] = revealBand;
  if (styles != nullptr) std::copy(styles->begin(), styles->end(), guide.styles);
  return guide;
}

std::vector<uint32_t> packLabels(const splat::SplatCloud& cloud) {
  const std::size_t count = cloud.count();
  std::vector<uint32_t> words((count + kLabelsPerWord - 1) / kLabelsPerWord, 0u);
  // Shifts rather than a byte copy, so the words read the same on any host.
  for (std::size_t i = 0; i < cloud.labels.size() && i < count; ++i) {
    words[i / kLabelsPerWord] |= static_cast<uint32_t>(cloud.labels[i])
                                 << ((i % kLabelsPerWord) * kBitsPerLabel);
  }
  return words;
}

}  // namespace splatkit

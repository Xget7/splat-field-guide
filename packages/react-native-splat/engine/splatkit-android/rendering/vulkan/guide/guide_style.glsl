// Field Guide's part styles and reveal, applied where a splat is projected. Layouts match
// LabelStyle and GuideUniform in splatkit/guide/GuideLayout.h, and the functions match Metal's
// GuideStyle.metalh.

#include "rendering/vulkan/guide/VulkanGuideBindings.h"

struct LabelStyle {
  vec3 tint;
  float tintAmount;
  float brightness;
  float opacity;
  vec2 reserved;
};

const uint kLabelCount = 256u;  // one style per value a label byte can take

layout(std140, set = 0, binding = SPLAT_GUIDE_BINDING) uniform Guide {
  vec2 reveal;  // world height drawn up to, and the glowing band under it
  vec2 pad;
  LabelStyle styles[kLabelCount];
} guide;

// Vulkan 1.1 does not guarantee 8-bit storage, so the label bytes are read as the words they
// pack into: byte i & 3 of word i >> 2 is splat i's label.
layout(std430, set = 0, binding = SPLAT_GUIDE_LABELS_BINDING) readonly buffer GuideLabels {
  uint labelWords[];
};

// The reveal band peaks in accent tint and brightness at the sweep level.
const vec3 kRevealTint = vec3(0x0A, 0x6C, 0xFF) / 255.0;
const float kRevealTintAmount = 0.85;
const float kRevealBoost = 0.9;

uint guideLabel(uint index) {
  return (labelWords[index >> 2u] >> ((index & 3u) * 8u)) & 0xffu;
}

// A splat above the reveal level is not drawn. A NaN height fails the comparison, so it is
// dropped too; with no reveal running the level is +infinity.
bool guideRevealed(float y) {
  return guide.reveal.x - y >= 0.0;
}

float guideOpacity(uint label) {
  return guide.styles[label].opacity;
}

// The captured colour mixed toward the part's tint and scaled by its brightness, then lit by the
// reveal band when the splat is close under the level.
vec3 guideColor(uint label, vec3 rgb, float y) {
  LabelStyle style = guide.styles[label];
  rgb = mix(rgb, style.tint, style.tintAmount) * style.brightness;
  if (guide.reveal.y > 0.0) {
    float glow = clamp(1.0 - (guide.reveal.x - y) / guide.reveal.y, 0.0, 1.0);
    glow *= glow;
    rgb = mix(rgb, kRevealTint, glow * kRevealTintAmount) * (1.0 + glow * kRevealBoost);
  }
  return rgb;
}

#version 450

// Half precision, as on Metal (SplatRaster.metal): the falloff and the blend need no more,
// and mediump lets the driver shade in fp16 (RelaxedPrecision).
precision mediump float;

layout(location = 0) in vec2 gaussian;  // corner * radius * kGaussianScale (splat.vert)
layout(location = 1) flat in vec4 color;  // rgb, log2(opacity)
layout(location = 0) out vec4 outColor;

const float kLog2MinAlpha = -7.994353;  // log2(1/255)

void main() {
  // log2 of the Gaussian falloff at this pixel times the splat's opacity: discarding on it
  // skips the exp2 for every fragment under 1/255. Level of detail nodes carry an opacity
  // above one, a solid core that the clamp holds at one.
  float power = color.a - dot(gaussian, gaussian);
  if (power < kLog2MinAlpha) discard;
  outColor = vec4(color.rgb, exp2(min(power, 0.0)));
}

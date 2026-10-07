#include "SplatTypes.metalh"

// A capture holds nothing past what was scanned, so the frame's own colours, spread outward and
// blurred, stand in for the surroundings instead of black.

// Coverage below this has no colour worth spreading; the frame is still empty.
constant float kBackdropEmpty = 1.0 / 1024.0;
// The finest pyramid level the fill takes detail from; coarser keeps the capture's edges out of it.
constant int kBackdropFinestLevel = 2;
// The backdrop sits behind the capture, so it stays darker and quieter than the capture itself,
// and darker still toward the corners, like light falling off around a subject.
constant float kBackdropGain = 0.55;
constant float kBackdropSaturation = 0.85;
constant float kBackdropVignette = 0.45;
constant float3 kLuma = float3(0.2126, 0.7152, 0.0722);
constant uint kReduceTaps = 4;  // per axis; each bilinear tap averages 2 by 2 texels
// Weights and offsets of a 9-tap Gaussian folded into 5 bilinear taps.
constant float kBlurOffsets[3] = {0.0, 1.3846153846, 3.2307692308};
constant float kBlurWeights[3] = {0.2270270270, 0.3162162162, 0.0702702703};

// Averages the premultiplied texels under one output pixel, `footprint` texels across.
fragment float4 backdropReduce(BlitVertex in [[stage_in]], texture2d<float> scene [[texture(0)]],
                               constant float2& footprint [[buffer(0)]]) {
  constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
  const float2 texel = 1.0 / float2(scene.get_width(), scene.get_height());
  float4 sum = 0;
  for (uint y = 0; y < kReduceTaps; ++y) {
    for (uint x = 0; x < kReduceTaps; ++x) {
      const float2 offset = ((float2(x, y) + 0.5) / kReduceTaps - 0.5) * footprint;
      sum += scene.sample(linearSampler, in.uv + offset * texel);
    }
  }
  return sum / (kReduceTaps * kReduceTaps);
}

// Pull-push fill: the coarsest level's mean colour, refined level by level wherever there is
// coverage, so every pixel takes the colour of the nearest captured surface.
fragment float4 backdropPush(BlitVertex in [[stage_in]], texture2d<float> pyramid [[texture(0)]]) {
  constexpr sampler levelSampler(filter::linear, mip_filter::nearest, address::clamp_to_edge);
  const int top = int(pyramid.get_num_mip_levels()) - 1;
  const float4 mean = pyramid.sample(levelSampler, in.uv, level(float(top)));
  if (mean.a < kBackdropEmpty) return float4(0, 0, 0, 1);
  float3 color = mean.rgb / mean.a;
  for (int lod = top - 1; lod >= kBackdropFinestLevel; --lod) {
    const float4 covered = pyramid.sample(levelSampler, in.uv, level(float(lod)));
    color = covered.rgb + (1.0 - covered.a) * color;
  }
  const float falloff = 1.0 - kBackdropVignette * smoothstep(0.2, 0.75, length(in.uv - 0.5));
  color = mix(float3(dot(color, kLuma)), color, kBackdropSaturation) * kBackdropGain * falloff;
  return float4(color, 1);
}

// One axis of a separable Gaussian; `spacing` is the UV distance one tap offset stands for.
fragment float4 backdropBlur(BlitVertex in [[stage_in]], texture2d<float> source [[texture(0)]],
                             constant float2& spacing [[buffer(0)]]) {
  constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
  float4 sum = source.sample(linearSampler, in.uv) * kBlurWeights[0];
  for (uint i = 1; i < 3; ++i) {
    sum += source.sample(linearSampler, in.uv + spacing * kBlurOffsets[i]) * kBlurWeights[i];
    sum += source.sample(linearSampler, in.uv - spacing * kBlurOffsets[i]) * kBlurWeights[i];
  }
  return sum;
}

// The capture over its backdrop, dithered so the backdrop's slow gradients do not band in 8 bits.
fragment float4 compositeFragment(BlitVertex in [[stage_in]], texture2d<float> scene [[texture(0)]],
                                  texture2d<float> backdrop [[texture(1)]]) {
  constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
  const float4 front = scene.sample(linearSampler, in.uv);
  const float3 back = backdrop.sample(linearSampler, in.uv).rgb;
  const float noise = fract(52.9829189 * fract(dot(in.position.xy, float2(0.06711056, 0.00583715))));
  return float4(front.rgb + (1.0 - front.a) * back + (noise - 0.5) / 255.0, 1);
}

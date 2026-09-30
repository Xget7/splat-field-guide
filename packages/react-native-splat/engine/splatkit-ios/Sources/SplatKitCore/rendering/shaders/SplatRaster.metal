#include "SplatTypes.metalh"
#include "SplatProjection.metalh"

// Rasterization and compositing of the splats the visibility pass projected and sorted,
// front to back.
vertex SplatVertex projectedVertex(uint vertexId [[vertex_id]], uint instanceId [[instance_id]],
                                   constant Camera& cam [[buffer(0)]],
                                   const device Projected* projected [[buffer(1)]],
                                   const device uint* order [[buffer(2)]]) {
  return expandQuad(cam, projected[order[instanceId]], vertexId);
}

// Premultiplied, for "under" blending into a target that starts transparent.
fragment float4 splatFragmentUnder(SplatVertex in [[stage_in]]) {
  half2 relative = half2(in.relativePosition);
  half r2 = dot(relative, relative);
  half alpha = min(exp(half(-0.5) * r2) * half(in.color.a), half(1.0));
  if (alpha < half(1.0 / 255.0)) discard_fragment();
  half3 rgb = half3(in.color.rgb) * alpha;
  return float4(float3(rgb), float(alpha));
}

// One oversized triangle covers the screen.
vertex BlitVertex blitVertex(uint vertexId [[vertex_id]]) {
  const float2 corners[3] = {float2(-1, -1), float2(3, -1), float2(-1, 3)};
  BlitVertex out;
  out.position = float4(corners[vertexId], 0, 1);
  out.uv = float2(corners[vertexId].x * 0.5 + 0.5, 0.5 - corners[vertexId].y * 0.5);
  return out;
}

fragment float4 blitFragment(BlitVertex in [[stage_in]], texture2d<float> source [[texture(0)]]) {
  constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
  return source.sample(linearSampler, in.uv);
}

fragment MaskOut saturationMask(BlitVertex in [[stage_in]], float4 dst [[color(0)]]) {
  if (dst.a < kSaturated) discard_fragment();
  MaskOut out;
  out.depth = kMaskDepth;
  return out;
}

fragment float4 backgroundFragment(BlitVertex in [[stage_in]], constant float4& color [[buffer(0)]]) {
  return color;
}

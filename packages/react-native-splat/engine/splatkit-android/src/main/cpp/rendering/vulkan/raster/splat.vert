#version 450
#extension GL_GOOGLE_include_directive : require

// CPU order path: one instance per splat in the uploaded order, four vertices per instance
// (triangle strip quad), projected here. The GPU path projects once in visibility.comp and
// draws with projected.vert.
#define SH_BINDING 3
#include "rendering/vulkan/layout/splat_projection.glsl"

layout(std430, set = 0, binding = 1) readonly buffer Splats { Splat splats[]; };
layout(std430, set = 0, binding = 2) readonly buffer Order { uint order[]; };

// Half precision, read by splat.frag. |gaussian|^2 is the falloff exponent in base 2.
layout(location = 0) out mediump vec2 gaussian;
layout(location = 1) flat out mediump vec4 color;  // rgb, log2(opacity)

void main() {
  uint index = order[gl_InstanceIndex];
  Splat s = splats[index];
  SplatView v;
  if (!projectSplat(s, v)) {
    // z beyond w is outside clip space, so the quad is discarded.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gaussian = vec2(0.0);
    color = vec4(0.0);
    return;
  }
  vec4 position;
  ProjectedSplat p = packProjected(s, index, v);
  revealGlow(s.py, p);
  expandQuad(p, uint(gl_VertexIndex), position, gaussian, color);
  gl_Position = position;
}

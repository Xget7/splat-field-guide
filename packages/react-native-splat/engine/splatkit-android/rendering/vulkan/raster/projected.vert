#version 450
#extension GL_GOOGLE_include_directive : require

// GPU order path: visibility.comp already projected the splats. One instance per survivor in
// sorted order, four vertices per instance (triangle strip quad).
#include "rendering/vulkan/layout/splat_camera.glsl"
#include "rendering/vulkan/layout/splat_quad.glsl"

layout(std430, set = 0, binding = 1) readonly buffer Projected { ProjectedSplat projected[]; };
layout(std430, set = 0, binding = 2) readonly buffer Order { uint order[]; };

// Half precision, read by splat.frag. |gaussian|^2 is the falloff exponent in base 2.
layout(location = 0) out mediump vec2 gaussian;
layout(location = 1) flat out mediump vec4 color;  // rgb, log2(opacity)

void main() {
  vec4 position;
  expandQuad(projected[order[gl_InstanceIndex]], uint(gl_VertexIndex), position, gaussian, color);
  gl_Position = position;
}

#version 450

layout(location = 0) in vec2 relativePosition;
layout(location = 1) in vec4 color;
layout(location = 0) out vec4 outColor;

void main() {
  float r2 = dot(relativePosition, relativePosition);
  // The Gaussian falloff evaluated at this pixel, scaled by the splat's opacity. The
  // vertex stage sized the quad so that nothing outside it would pass the threshold.
  // Level of detail nodes carry an opacity above one: a solid core that fades at the edge.
  float alpha = min(exp(-0.5 * r2) * color.a, 1.0);
  if (alpha < 1.0 / 255.0) discard;
  outColor = vec4(color.rgb, alpha);
}

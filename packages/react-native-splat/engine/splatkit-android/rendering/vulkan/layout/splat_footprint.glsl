// The quad a splat draws as, shared by visibility.comp and splat.vert so the cull and the
// draw agree. Matches Metal's projectSplat (SplatProjection.metalh).

// Peak opacity at which the quad ends; below it a splat has no quad. The host sets it from
// kQuadMinAlpha (VulkanShaderTypes.h) so the reported policy cannot drift from the shader.
layout(constant_id = 1) const float QUAD_MIN_ALPHA = 2.0 / 255.0;

// A blob at 2.5 sigma keeps 4 % of its peak; an LOD opacity of 1000 stays visible to 4.9 sigma.
const float kBoundsRadius = 2.5;
const float kLodBoundsRadius = 5.0;
// A splat near the camera can project to thousands of pixels; its quad is cut here instead.
const float kMaxPixelRadius = 512.0;

// Radius in sigma where alpha * exp(-r^2 / 2) falls to QUAD_MIN_ALPHA, for ellipse axes that
// are sigma in pixels. Cutting it truncates the Gaussian without reshaping it.
float quadRadius(float alpha, bool lod, vec2 axis1, vec2 axis2) {
  float radius = min(lod ? kLodBoundsRadius : kBoundsRadius,
                     sqrt(2.0 * log(max(alpha / QUAD_MIN_ALPHA, 1.0))));
  float sigmaPixels = sqrt(max(dot(axis1, axis1), dot(axis2, axis2)));
  return min(radius, kMaxPixelRadius / max(sigmaPixels, 1.0e-6));
}

// The projected record and the quad both vertex stages expand from it. Matches Metal's
// Projected (SplatTypes.metalh) and expandQuad (SplatProjection.metalh).
// Include after splat_camera.glsl.

// ProjectedSplat in GpuLayout.h: 32 bytes, pairs of halves low first.
struct ProjectedSplat {
  vec2 center;  // normalized device coordinates, before the display's rotation
  uint axis1;   // halves: the ellipse's major axis, sigma in pixels
  uint axis2;   // halves: the minor axis
  uint color0;  // halves: red, green
  uint color1;  // halves: blue, peak opacity
  float radius; // quad half-width in sigma
  uint index;   // the source splat
};

const vec2 kCorners[4] = vec2[](vec2(-1, -1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));
// sqrt(0.5 * log2(e)): exp(-r^2 / 2) = exp2(-(kGaussianScale * r)^2).
const float kGaussianScale = 0.8493218;
// Smallest normal half, so log2 of the packed opacity stays finite.
const float kHalfMin = 6.103515625e-05;
// No depth test: every quad draws at one depth inside the clip volume. The cull already
// dropped splats whose centre lies outside it.
const float kSplatDepth = 0.5;

// Corner `vertexIndex` of the record's quad. `gaussian` scaled so its squared length is the
// falloff exponent in base 2; `color` is rgb and log2 of the peak opacity.
void expandQuad(ProjectedSplat p, uint vertexIndex, out vec4 position, out vec2 gaussian,
                out vec4 color) {
  vec2 corner = kCorners[vertexIndex];
  vec2 delta = (corner.x * unpackHalf2x16(p.axis1) + corner.y * unpackHalf2x16(p.axis2)) * 2.0 *
               p.radius / cam.screenSize;
  position = vec4(preRotate(p.center + delta), kSplatDepth, 1.0);
  gaussian = p.radius * kGaussianScale * corner;
  vec2 color1 = unpackHalf2x16(p.color1);
  color = vec4(unpackHalf2x16(p.color0), color1.x, log2(max(color1.y, kHalfMin)));
}

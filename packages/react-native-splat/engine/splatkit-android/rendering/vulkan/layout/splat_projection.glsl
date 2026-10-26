// The source record and its projection, shared by visibility.comp (GPU order) and splat.vert
// (CPU order). Matches Metal's projectSplat (SplatProjection.metalh), which follows the
// reference rasterizer of Kerbl et al. 2023 and Zwicker's EWA projection.
// The including shader defines SH_BINDING, the set 0 binding of the spherical harmonics.

#include "rendering/vulkan/layout/splat_camera.glsl"
#include "rendering/vulkan/layout/splat_footprint.glsl"
#include "rendering/vulkan/layout/splat_quad.glsl"

// GpuSplat in GpuLayout.h.
struct Splat {
  float px, py, pz;  // world position
  uint rgba8;        // colour and alpha, 8 bits each
  uint cov0;         // halves: xx, xy
  uint cov1;         // halves: xz, yy
  uint cov2;         // halves: yz, zz
  uint lodAlpha;     // float bits of an opacity above 1 (level of detail nodes), else 0
};

// Spherical harmonics degree of the world, 0 to 3: one pipeline per degree.
// With degree 0 the SH buffer is never read.
layout(constant_id = 0) const uint SH_DEGREE = 0;
const uint SH_COEFFICIENTS = (SH_DEGREE + 1) * (SH_DEGREE + 1) - 1;
// Coefficients are rgb halves, channel fastest, two halves per uint, no padding.
const uint SH_STRIDE = (SH_COEFFICIENTS * 3 + 1) / 2;
layout(std430, set = 0, binding = SH_BINDING) readonly buffer Sh { uint shData[]; };

// Variance, in squared pixels, added to every projected covariance: the low-pass filter of the
// reference rasterizer, which keeps every splat at least about a pixel wide.
const float kLowPassVariance = 0.3;
// The centre's view-space x/y is clamped to this multiple of the half field of view before the
// projection is linearised, so the Jacobian stays finite at the frustum edges.
const float kProjectionFovClamp = 1.3;
const float kDisplayGamma = 2.2;  // for a linear-blended output

// Projects the 3D covariance to screen space: Sigma' = J W Sigma W^T J^T.
vec3 projectCovariance(vec3 viewPos, vec4 covA, vec2 covB) {
  float safeZ = min(viewPos.z, -1.0e-4);
  float invZ = 1.0 / safeZ;
  float invZ2 = invZ * invZ;
  vec2 lim = kProjectionFovClamp * cam.tanHalfFov;
  viewPos.x = clamp(viewPos.x * invZ, -lim.x, lim.x) * safeZ;
  viewPos.y = clamp(viewPos.y * invZ, -lim.y, lim.y) * safeZ;
  mat3 j = mat3(cam.focal.x * invZ, 0.0, 0.0,
                0.0, cam.focal.y * invZ, 0.0,
                -cam.focal.x * viewPos.x * invZ2,
                -cam.focal.y * viewPos.y * invZ2, 0.0);
  mat3 t = j * mat3(cam.view);
  mat3 source = mat3(covA.x, covA.y, covA.z,
                     covA.y, covA.w, covB.x,
                     covA.z, covB.x, covB.y);
  mat3 projected = t * source * transpose(t);
  return vec3(projected[0][0] + kLowPassVariance, projected[0][1],
              projected[1][1] + kLowPassVariance);
}

// Eigen decomposition of the symmetric 2x2 (a, b; b, d): the ellipse axes, sigma in pixels.
void ellipseAxes(vec3 covariance, out vec2 axis1, out vec2 axis2) {
  float a = covariance.x, b = covariance.y, d = covariance.z;
  float determinant = a * d - b * b;
  float mean = 0.5 * (a + d);
  float distance = max(0.1, sqrt(max(mean * mean - determinant, 0.0)));
  float lambda1 = mean + distance;
  float lambda2 = mean - distance;
  vec2 e1 = b == 0.0 ? ((a > d) ? vec2(1.0, 0.0) : vec2(0.0, 1.0))
                     : normalize(vec2(b, d - lambda2));
  vec2 e2 = vec2(e1.y, -e1.x);
  axis1 = e1 * sqrt(max(lambda1, 0.0));
  axis2 = e2 * sqrt(max(lambda2, 0.0));
}

// Half number h of splat `base` in the SH buffer.
float shHalf(uint base, uint h) {
  vec2 pair = unpackHalf2x16(shData[base + h / 2u]);
  return (h & 1u) == 0u ? pair.x : pair.y;
}

vec3 shCoefficient(uint base, uint k) {
  return vec3(shHalf(base, k * 3u), shHalf(base, k * 3u + 1u), shHalf(base, k * 3u + 2u));
}

// Colour change along the unit direction `d` from the camera to the splat, from the real
// spherical harmonics bands 1 to 3 in the 3DGS reference convention. The base colour already
// contains the band 0 term (0.5 + C0 * dc).
vec3 shColor(uint index, vec3 d) {
  const float C1 = 0.4886025119;
  const float C2[5] = float[](1.0925484306, -1.0925484306, 0.3153915653, -1.0925484306, 0.5462742153);
  const float C3[7] = float[](-0.5900435899, 2.8906114426, -0.4570457995, 0.3731763326,
                              -0.4570457995, 1.4453057213, -0.5900435899);
  uint base = index * SH_STRIDE;
  float x = d.x, y = d.y, z = d.z;
  vec3 c = -C1 * y * shCoefficient(base, 0u) + C1 * z * shCoefficient(base, 1u) -
           C1 * x * shCoefficient(base, 2u);
  if (SH_DEGREE >= 2u) {
    float xx = x * x, yy = y * y, zz = z * z, xy = x * y, yz = y * z, xz = x * z;
    c += C2[0] * xy * shCoefficient(base, 3u) + C2[1] * yz * shCoefficient(base, 4u) +
         C2[2] * (2.0 * zz - xx - yy) * shCoefficient(base, 5u) +
         C2[3] * xz * shCoefficient(base, 6u) + C2[4] * (xx - yy) * shCoefficient(base, 7u);
    if (SH_DEGREE >= 3u) {
      c += C3[0] * y * (3.0 * xx - yy) * shCoefficient(base, 8u) +
           C3[1] * xy * z * shCoefficient(base, 9u) +
           C3[2] * y * (4.0 * zz - xx - yy) * shCoefficient(base, 10u) +
           C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoefficient(base, 11u) +
           C3[4] * x * (4.0 * zz - xx - yy) * shCoefficient(base, 12u) +
           C3[5] * z * (xx - yy) * shCoefficient(base, 13u) +
           C3[6] * x * (xx - 3.0 * yy) * shCoefficient(base, 14u);
    }
  }
  return c;
}

// A splat projected for the current camera, before it is packed.
struct SplatView {
  vec4 clip;        // the centre in clip space
  vec3 viewPos;
  vec3 covariance;  // screen space (xx, xy, yy), squared pixels, low-pass filter included
  vec2 axis1, axis2;
  float alpha;      // peak opacity, above 1 for level of detail nodes
  float radius;     // quad half-width in sigma
};

// False when the splat has no quad on screen: its peak is under the quad cutoff, its centre is
// outside the near and far planes, its half-packed quad misses the view, or its footprint is
// under the camera's sub-pixel cutoff.
bool projectSplat(Splat s, out SplatView v) {
  vec4 rgba = unpackUnorm4x8(s.rgba8);
  v.alpha = s.lodAlpha != 0u ? uintBitsToFloat(s.lodAlpha) : rgba.a;
  // Dark but opaque splats are kept: they occlude. NaN fails every comparison.
  if (!(v.alpha >= QUAD_MIN_ALPHA)) return false;

  vec4 viewPos4 = cam.view * vec4(s.px, s.py, s.pz, 1.0);
  v.viewPos = viewPos4.xyz;
  if (!(v.viewPos.z < 0.0)) return false;
  v.clip = cam.proj * viewPos4;
  // Vulkan's clip depth is [0, w]. The sides use the quad's footprint below.
  if (!(v.clip.z >= 0.0 && v.clip.z <= v.clip.w)) return false;

  vec2 c0 = unpackHalf2x16(s.cov0);
  vec2 c1 = unpackHalf2x16(s.cov1);
  vec2 c2 = unpackHalf2x16(s.cov2);
  v.covariance = projectCovariance(v.viewPos, vec4(c0, c1), c2);
  ellipseAxes(v.covariance, v.axis1, v.axis2);
  v.radius = quadRadius(v.alpha, s.lodAlpha != 0u, v.axis1, v.axis2);

  // Bound the half-packed quad the raster stage draws, not just its centre: a large or
  // anisotropic splat crossing an edge must survive.
  vec2 packedAxis1 = unpackHalf2x16(packHalf2x16(v.axis1));
  vec2 packedAxis2 = unpackHalf2x16(packHalf2x16(v.axis2));
  vec2 extentPixels = v.radius * (abs(packedAxis1) + abs(packedAxis2));
  vec2 margin = (extentPixels + 0.5) * 2.0 * v.clip.w / cam.screenSize;
  if (any(greaterThan(abs(v.clip.xy), vec2(v.clip.w) + margin))) return false;

  // The largest eigenvalue of the covariance itself, the source's share of it.
  float halfDifference = 0.5 * (v.covariance.x - v.covariance.z);
  float sourceVariance = 0.5 * (v.covariance.x + v.covariance.z) +
                         sqrt(max(halfDifference * halfDifference +
                                      v.covariance.y * v.covariance.y, 0.0)) -
                         kLowPassVariance;
  // NaN fails the comparison.
  return sqrt(max(sourceVariance, 0.0)) * v.radius >= cam.minPixelRadius;
}

// The record the raster stage expands, with the colour seen from the camera in the output's
// encoding.
ProjectedSplat packProjected(Splat s, uint index, SplatView v) {
  vec3 rgb = unpackUnorm4x8(s.rgba8).rgb;
  if (SH_DEGREE >= 1u) {
    vec3 dir = normalize(vec3(s.px, s.py, s.pz) - cam.cameraPosition.xyz);
    rgb = max(rgb + shColor(index, dir), vec3(0.0));
  }
  if (cam.outputLinear == 1u) rgb = pow(rgb, vec3(kDisplayGamma));
  ProjectedSplat p;
  p.center = v.clip.xy / v.clip.w;
  p.axis1 = packHalf2x16(v.axis1);
  p.axis2 = packHalf2x16(v.axis2);
  p.color0 = packHalf2x16(rgb.rg);
  p.color1 = packHalf2x16(vec2(rgb.b, v.alpha));
  p.radius = v.radius;
  p.index = index;
  return p;
}

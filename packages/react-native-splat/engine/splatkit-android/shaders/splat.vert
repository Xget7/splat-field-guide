#version 450

// One instance per splat, four vertices per instance (triangle strip quad).
// Ported from MetalSplatter's SplatProcessing.metal, which follows the reference
// rasterizer of Kerbl et al. 2023 and Zwicker's EWA projection.

struct LabelStyle { vec4 tint; vec4 material; };

layout(set = 0, binding = 0) uniform Camera {
  mat4 view;
  mat4 proj;
  vec2 focal;         // pixels: screenSize * proj[0][0] / 2, screenSize * proj[1][1] / 2
  vec2 tanHalfFov;    // 1 / proj[0][0], 1 / proj[1][1]
  vec2 screenSize;    // pixels
  uint outputLinear;  // 1 when the swapchain is sRGB and expects linear values
  uint pad;
  vec4 cameraPosition;  // world space, for the view direction the SH is evaluated along
  vec4 reveal;
  LabelStyle styles[256];
} cam;

// Spherical harmonics degree of the world, 0 to 3: one pipeline per degree.
// With degree 0 the SH buffer is never read.
layout(constant_id = 0) const uint SH_DEGREE = 0;
const uint SH_COEFFICIENTS = (SH_DEGREE + 1) * (SH_DEGREE + 1) - 1;
// Coefficients are rgb halves, channel fastest, two halves per uint, no padding.
const uint SH_STRIDE = (SH_COEFFICIENTS * 3 + 1) / 2;

struct Splat {
  float px, py, pz;  // world position
  uint rgba8;        // colour and alpha, 8 bits each
  uint cov0;         // halves: xx, xy
  uint cov1;         // halves: xz, yy
  uint cov2;         // halves: yz, zz
  uint partLabel;
};

layout(std430, set = 0, binding = 1) readonly buffer Splats { Splat splats[]; };
layout(std430, set = 0, binding = 2) readonly buffer Order { uint order[]; };
layout(std430, set = 0, binding = 3) readonly buffer Sh { uint shData[]; };

layout(location = 0) out vec2 relativePosition;  // in units of sigma
layout(location = 1) out vec4 color;

const float kBoundsRadius = 3.0;  // draw out to 3 sigma; beyond that nothing is visible
const vec2 kCorners[4] = vec2[](vec2(-1, -1), vec2(-1, 1), vec2(1, -1), vec2(1, 1));

// Projects the 3D covariance to screen space: Sigma' = J W Sigma W^T J^T.
vec3 projectCovariance(vec3 viewPos, vec4 covA, vec2 covB) {
  float invZ = 1.0 / viewPos.z;
  float invZ2 = invZ * invZ;

  // Clamp the projected center so the Jacobian stays finite at the frustum edges.
  vec2 lim = 1.3 * cam.tanHalfFov;
  viewPos.x = clamp(viewPos.x * invZ, -lim.x, lim.x) * viewPos.z;
  viewPos.y = clamp(viewPos.y * invZ, -lim.y, lim.y) * viewPos.z;

  mat3 J = mat3(
    cam.focal.x * invZ, 0.0, 0.0,
    0.0, cam.focal.y * invZ, 0.0,
    -cam.focal.x * viewPos.x * invZ2, -cam.focal.y * viewPos.y * invZ2, 0.0);
  mat3 W = mat3(cam.view);
  mat3 T = J * W;
  mat3 Vrk = mat3(
    covA.x, covA.y, covA.z,
    covA.y, covA.w, covB.x,
    covA.z, covB.x, covB.y);
  mat3 cov = T * Vrk * transpose(T);
  // Low pass filter: every splat is at least about a pixel wide, so none flicker.
  return vec3(cov[0][0] + 0.3, cov[0][1], cov[1][1] + 0.3);
}

// Eigen decomposition of the symmetric 2x2 (a, b; b, d): the ellipse axes in pixels.
void ellipseAxes(vec3 cov2D, out vec2 axis1, out vec2 axis2) {
  float a = cov2D.x, b = cov2D.y, d = cov2D.z;
  float det = a * d - b * b;
  float mean = 0.5 * (a + d);
  float dist = max(0.1, sqrt(max(mean * mean - det, 0.0)));
  float lambda1 = mean + dist;
  float lambda2 = mean - dist;
  vec2 e1 = (b == 0.0) ? ((a > d) ? vec2(1, 0) : vec2(0, 1)) : normalize(vec2(b, d - lambda2));
  vec2 e2 = vec2(e1.y, -e1.x);
  axis1 = e1 * sqrt(lambda1);
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

// Colour change along the unit direction `d` from the camera to the splat, from the
// real spherical harmonics bands 1 to 3 in the 3DGS reference convention. The base
// colour already contains the band 0 term (0.5 + C0 * dc).
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

void main() {
  uint index = order[gl_InstanceIndex];
  Splat s = splats[index];
  float underLevel = cam.reveal.x - s.py;
  if (!(underLevel >= 0.0)) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vec4 viewPos4 = cam.view * vec4(s.px, s.py, s.pz, 1.0);
  vec3 viewPos = viewPos4.xyz;
  // Behind the camera: emit a vertex outside clip space so the quad is discarded.
  if (viewPos.z >= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  vec4 clip = cam.proj * viewPos4;
  float bounds = 1.2 * clip.w;
  if (clip.z < 0.0 || clip.z > clip.w ||
      clip.x < -bounds || clip.x > bounds || clip.y < -bounds || clip.y > bounds) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }

  vec2 c0 = unpackHalf2x16(s.cov0);
  vec2 c1 = unpackHalf2x16(s.cov1);
  vec2 c2 = unpackHalf2x16(s.cov2);
  vec3 cov2D = projectCovariance(viewPos, vec4(c0, c1), c2);
  vec2 axis1, axis2;
  ellipseAxes(cov2D, axis1, axis2);

  // Draw only out to where this splat's contribution drops below 1/255, which is
  // where the fragment stage would discard anyway: exp(-r^2 / 2) * alpha = 1 / 255.
  // Faint splats, the majority, get a much smaller quad; opaque ones keep 3 sigma.
  vec4 rgba = unpackUnorm4x8(s.rgba8);
  // A level of detail node stands in for many overlapping splats: its opacity exceeds
  // one and its solid core reaches further out before the falloff takes it under 1/255.
  float alpha = rgba.a * cam.styles[s.partLabel & 255u].material.y;
  float radius = min(kBoundsRadius,
                     sqrt(2.0 * log(max(alpha * 255.0, 1.0))));

  vec2 corner = kCorners[gl_VertexIndex];
  vec2 delta = (corner.x * axis1 + corner.y * axis2) * 2.0 * radius / cam.screenSize;
  gl_Position = vec4(clip.xy + delta * clip.w, clip.z, clip.w);
  relativePosition = radius * corner;

  vec3 rgb = rgba.rgb;
  if (SH_DEGREE >= 1u) {
    vec3 dir = normalize(vec3(s.px, s.py, s.pz) - cam.cameraPosition.xyz);
    rgb = max(rgb + shColor(index, dir), vec3(0.0));
  }
  LabelStyle style = cam.styles[s.partLabel & 255u];
  rgb = mix(rgb, style.tint.rgb, style.tint.a) * style.material.x;
  if (cam.reveal.y > 0.0) {
    float glow = clamp(1.0 - underLevel / cam.reveal.y, 0.0, 1.0);
    glow *= glow;
    rgb = mix(rgb, vec3(0.0392156863, 0.4235294118, 1.0), glow * 0.85) * (1.0 + glow * 0.9);
  }
  if (cam.outputLinear == 1u) rgb = pow(rgb, vec3(2.2));
  color = vec4(rgb, alpha);
}

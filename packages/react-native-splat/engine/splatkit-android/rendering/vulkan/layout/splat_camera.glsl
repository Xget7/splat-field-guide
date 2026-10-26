// The camera every splat shader reads at set 0, binding 0: CameraUniform in
// VulkanShaderTypes.h.

layout(set = 0, binding = 0, std140) uniform Camera {
  mat4 view;
  mat4 proj;
  vec2 focal;         // pixels: screenSize * proj[0][0] / 2, screenSize * proj[1][1] / 2
  vec2 tanHalfFov;    // 1 / proj[0][0], 1 / proj[1][1]
  vec2 screenSize;    // pixels, in the window's orientation
  uint outputLinear;  // 1 when the swapchain is sRGB and expects linear values
  uint quarterTurns;  // clockwise, 0 to 3: the display's rotation the image is drawn with
  vec4 cameraPosition;  // world space, for the view direction the SH is evaluated along
  float minPixelRadius;  // pixels: smallest source sigma times quad radius that is drawn
} cam;

// Turns clip space clockwise by the display's rotation. The swapchain image has the display's
// native orientation and is scanned out as it is (VulkanSwapchain), so everything sized in
// pixels uses the window's orientation and only the final position turns. Clip y is up.
vec2 preRotate(vec2 p) {
  if (cam.quarterTurns == 1u) return vec2(p.y, -p.x);
  if (cam.quarterTurns == 2u) return -p;
  if (cam.quarterTurns == 3u) return vec2(-p.y, p.x);
  return p;
}

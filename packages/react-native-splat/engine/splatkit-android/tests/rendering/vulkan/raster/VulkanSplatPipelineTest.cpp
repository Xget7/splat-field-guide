#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <optional>
#include <utility>
#include <vector>

#include "rendering/vulkan/cull/VulkanVisibilityPass.h"
#include "rendering/vulkan/frame/VulkanCameraUniforms.h"
#include "rendering/vulkan/frame/VulkanFrameCompute.h"
#include "rendering/vulkan/presentation/VulkanRenderTarget.h"
#include "rendering/vulkan/raster/VulkanSplatPipeline.h"
#include "rendering/vulkan/world/VulkanWorld.h"
#include "splat/math/Half.h"
#include "splatkit/highlight/Highlight.h"
#include "splatkit/labels/LabelStyles.h"
#include "splatkit/rendering/GpuLayout.h"
#include "splatkit/reveal/Reveal.h"
#include "support/VulkanTestContext.h"

namespace {
using splatkit::ProjectedSplat;
using splatkit::RevealUniform;
using splatkit::SplatRenderer;
using splatkit::VulkanBuffer;
using splatkit::VulkanCameraUniforms;
using splatkit::VulkanFrameCompute;
using splatkit::VulkanRenderTarget;
using splatkit::VulkanSplatPipeline;
using splatkit::VulkanVisibilityPass;
using splatkit::VulkanWorld;
namespace test = splatkit::test;
using test::require;
using Gpu = test::VulkanTestContext;

constexpr VkExtent2D kExtent{64, 64};
constexpr VkFormat kFormat = VK_FORMAT_R8G8B8A8_UNORM;
constexpr float kDepth = 5;
constexpr float kSigmaPixels = 8;
// The rasterizer's low-pass filter adds this to the projected variance (splat.vert).
constexpr float kLowPassVariance = 0.3f;
// Pixels this close to the quad's edge may fall either side of it.
constexpr float kEdgePixels = 1.5f;
// Absolute error, in 8-bit steps, allowed per pixel: rounding plus half-precision shading.
constexpr int kTolerance = 2;

struct Scene {
  std::unique_ptr<VulkanCameraUniforms> cameras;
  std::unique_ptr<VulkanRenderTarget> target;
  std::unique_ptr<VulkanSplatPipeline> pipeline;
  splat::Mat4 proj = splat::Mat4::perspective(1, 1, 0.1f, 100);
};

Scene scene(const Gpu& gpu) {
  Scene s;
  auto cameras = VulkanCameraUniforms::create(*gpu.context);
  require(static_cast<bool>(cameras), "camera uniforms");
  s.cameras = std::move(cameras.value());
  auto target = VulkanRenderTarget::create(*gpu.context, kFormat, kExtent);
  require(static_cast<bool>(target), "offscreen target");
  s.target = std::move(target.value());
  auto pipeline = VulkanSplatPipeline::create(*gpu.context, s.target->renderPass(), *s.cameras);
  require(static_cast<bool>(pipeline), "splat pipeline");
  s.pipeline = std::move(pipeline.value());
  return s;
}

void testCameraRejection(const Scene& s) {
  for (uint32_t slot = 0; slot < splatkit::kFramesInFlight; ++slot) {
    const auto update = [&](const splat::Mat4& projection, VkExtent2D extent) {
      return s.cameras->update(slot, splat::Mat4::identity(), projection, {0, 0, 0}, extent, false,
                               0, 0);
    };
    require(update(s.proj, kExtent) == s.cameras->buffer(slot), "valid camera buffer");
    require(update(splat::Mat4::identity(), kExtent) == VK_NULL_HANDLE,
            "reject invalid projection before dispatch");
    require(update(s.proj, {0, kExtent.height}) == VK_NULL_HANDLE,
            "reject invalid viewport before dispatch");
    require(update(s.proj, kExtent) == s.cameras->buffer(slot), "camera recovers in either slot");
  }
  std::puts("PASS camera upload rejects invalid frames and recovers in either slot");
}

using Record = std::function<void(VkCommandBuffer)>;

// The RGBA pixels of what `before` and `draw` record, over transparent black: `before` runs
// outside the render pass, `draw` inside it, after the camera of frame slot `slot` is written.
// `minPixelRadius` is the camera's cutoff.
std::vector<uint8_t> renderRgba(const Gpu& gpu, const Scene& s, const Record& before,
                                const Record& draw, float minPixelRadius = 0, uint32_t slot = 0,
                                const RevealUniform& reveal = {}) {
  require(s.cameras->update(slot, splat::Mat4::identity(), s.proj, {0, 0, 0}, kExtent, false, 0,
                            minPixelRadius, 1, reveal) == s.cameras->buffer(slot),
          "camera upload");
  const VkDeviceSize bytes = VkDeviceSize{kExtent.width} * kExtent.height * 4;
  auto pixels = VulkanBuffer::hostVisible(*gpu.context, bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT);
  require(pixels && pixels->mapped(), "pixel readback buffer");
  gpu.submit([&](VkCommandBuffer cmd) {
    before(cmd);
    const VkClearValue clear{};
    VkRenderPassBeginInfo pass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
    pass.renderPass = s.target->renderPass();
    pass.framebuffer = s.target->framebuffer();
    pass.renderArea.extent = kExtent;
    pass.clearValueCount = 1;
    pass.pClearValues = &clear;
    vkCmdBeginRenderPass(cmd, &pass, VK_SUBPASS_CONTENTS_INLINE);
    const auto width = static_cast<float>(kExtent.width);
    const auto height = static_cast<float>(kExtent.height);
    const VkViewport viewport{0, height, width, -height, 0, 1};
    const VkRect2D scissor{{0, 0}, kExtent};
    vkCmdSetViewport(cmd, 0, 1, &viewport);
    vkCmdSetScissor(cmd, 0, 1, &scissor);
    draw(cmd);
    vkCmdEndRenderPass(cmd);
    VkMemoryBarrier written{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    written.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    written.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                         VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 1, &written, 0, nullptr, 0, nullptr);
    VkBufferImageCopy copy{};
    copy.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
    copy.imageExtent = {kExtent.width, kExtent.height, 1};
    vkCmdCopyImageToBuffer(cmd, s.target->image(), VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                           pixels->handle(), 1, &copy);
    VkMemoryBarrier copied{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    copied.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    copied.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_HOST_BIT, 0, 1,
                         &copied, 0, nullptr, 0, nullptr);
  });
  pixels->invalidate(0, bytes);
  const auto* rgba = static_cast<const uint8_t*>(pixels->mapped());
  return {rgba, rgba + bytes};
}

std::vector<uint8_t> render(const Gpu& gpu, const Scene& s, const Record& before,
                            const Record& draw, float minPixelRadius = 0) {
  const auto rgba = renderRgba(gpu, s, before, draw, minPixelRadius);
  std::vector<uint8_t> red(kExtent.width * kExtent.height);
  for (size_t i = 0; i < red.size(); ++i) red[i] = rgba[i * 4];
  return red;
}

// One white splat at the centre of the view, projected by the CPU-order vertex stage.
std::vector<uint8_t> renderCpuOrder(const Gpu& gpu, const Scene& s, float alpha,
                                    float sigmaPixels = kSigmaPixels, float minPixelRadius = 0) {
  const float worldSigma = sigmaPixels * kDepth / (kExtent.width * s.proj.at(0, 0) / 2);
  const float variance = worldSigma * worldSigma;
  splat::SplatCloud cloud;
  cloud.positions = {0, 0, -kDepth};
  cloud.covariances = {variance, 0, 0, variance, 0, variance};
  cloud.colors = {1, 1, 1};
  cloud.alphas = {alpha};
  auto world = VulkanWorld::upload(*gpu.context, cloud, 0, true);
  require(world != nullptr, "world upload");
  s.pipeline->bindWorld(*world);
  const uint32_t order = 0;
  return render(
      gpu, s, [&](VkCommandBuffer cmd) { world->recordOrderUpload(cmd, 0, &order, 1); },
      [&](VkCommandBuffer cmd) { s.pipeline->draw(cmd, 0, *world, 1, 0); }, minPixelRadius);
}

uint32_t packHalves(float low, float high) {
  return splat::toHalf(low) | (static_cast<uint32_t>(splat::toHalf(high)) << 16);
}

// The same splat as a projected record, as the visibility pass writes it, drawn indirectly.
std::vector<uint8_t> renderProjected(const Gpu& gpu, const Scene& s, float alpha, float radius) {
  const float sigma = std::sqrt(kSigmaPixels * kSigmaPixels + kLowPassVariance);
  const ProjectedSplat record{{0, 0},
                              packHalves(sigma, 0),
                              packHalves(0, -sigma),
                              packHalves(1, 1),
                              packHalves(1, alpha),
                              radius,
                              0};
  const uint32_t order = 0;
  const VkDrawIndirectCommand arguments{4, 1, 0, 0};
  const auto buffer = [&](const void* data, VkDeviceSize bytes, VkBufferUsageFlags usage) {
    auto b = VulkanBuffer::deviceLocal(*gpu.context, bytes, usage);
    require(b && b->upload(data, bytes), "projected draw input");
    return b;
  };
  auto projected = buffer(&record, sizeof(record), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  auto orders = buffer(&order, sizeof(order), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  auto indirect = buffer(&arguments, sizeof(arguments), VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT);
  s.pipeline->bindProjected(0, projected->handle(), orders->handle(), 1);
  return render(
      gpu, s, [](VkCommandBuffer) {},
      [&](VkCommandBuffer cmd) { s.pipeline->drawProjected(cmd, 0, indirect->handle()); });
}

// Compares every pixel with alpha * exp(-r^2 / 2), cut at the quad's half-width `radius`
// sigma and at the fragment's 1/255 discard. Pixels on the quad's edge are skipped.
void requireGaussian(const std::vector<uint8_t>& red, float alpha, float radius) {
  const float sigma = std::sqrt(kSigmaPixels * kSigmaPixels + kLowPassVariance);
  const float half = radius * sigma;
  int compared = 0;
  for (uint32_t y = 0; y < kExtent.height; ++y) {
    for (uint32_t x = 0; x < kExtent.width; ++x) {
      const float dx = x + 0.5f - kExtent.width / 2.0f;
      const float dy = y + 0.5f - kExtent.height / 2.0f;
      const float edge = std::max(std::abs(dx), std::abs(dy));
      if (std::abs(edge - half) < kEdgePixels) continue;
      float expected = 0;
      if (edge < half) {
        expected = std::min(alpha * std::exp(-0.5f * (dx * dx + dy * dy) / (sigma * sigma)), 1.0f);
        if (expected < 1.0f / 255.0f) expected = 0;
      }
      const int got = red[y * kExtent.width + x];
      if (std::abs(got - static_cast<int>(std::lround(expected * 255))) > kTolerance) {
        std::fprintf(stderr, "pixel %u,%u: got %d, expected %.2f\n", x, y, got, expected * 255);
        require(false, "pixel matches the CPU Gaussian");
      }
      ++compared;
    }
  }
  require(compared > 0, "pixels compared");
}

void testTranslucent(const Gpu& gpu, const Scene& s) {
  // Peak 0.8 reaches the 2/255 cutoff past 2.5 sigma, so the quad stops at 2.5 sigma.
  requireGaussian(renderCpuOrder(gpu, s, 0.8f), 0.8f, 2.5f);
  std::puts("PASS translucent splat matches the Gaussian out to 2.5 sigma");
}

void testLodCore(const Gpu& gpu, const Scene& s) {
  // An LOD opacity of 3 is solid in its core and meets the 2/255 cutoff at 3.45 sigma.
  const float alpha = 3;
  requireGaussian(renderCpuOrder(gpu, s, alpha), alpha, std::sqrt(2 * std::log(alpha * 255 / 2)));
  std::puts("PASS LOD splat saturates in its core and fades to its quad edge");
}

// MetalSplatRendererTest.SubpixelCutoffAppliesLiveOnBothOrderPaths draws the same splat.
void testCpuOrderCutoff(const Gpu& gpu, const Scene& s) {
  // Source sigma 0.3 px with an opaque 2.5 sigma quad: a 0.75 px footprint.
  const auto brightest = [&](float cutoff) {
    const auto red = renderCpuOrder(gpu, s, 1, 0.3f, cutoff);
    return *std::max_element(red.begin(), red.end());
  };
  require(brightest(1.0f) == 0, "a 1 px cutoff drops a 0.75 px footprint");
  require(brightest(0.5f) > 64, "a 0.5 px cutoff draws a 0.75 px footprint");
  std::puts("PASS the CPU-order draw drops a footprint under the camera's cutoff");
}

void testProjectedPath(const Gpu& gpu, const Scene& s) {
  requireGaussian(renderProjected(gpu, s, 0.8f, 2.5f), 0.8f, 2.5f);
  const float alpha = 3;
  const float radius = std::sqrt(2 * std::log(alpha * 255 / 2));
  requireGaussian(renderProjected(gpu, s, alpha, radius), alpha, radius);
  std::puts("PASS projected records draw the same Gaussians as the CPU-order path");
}

// World units at depth kDepth for a distance on screen in pixels.
float worldUnits(const Scene& s, float pixels) {
  return pixels * kDepth / (kExtent.width * s.proj.at(0, 0) / 2);
}
splat::SplatCloud cloudAt(const Scene& s, const std::vector<std::pair<float, float>>& pixels,
                          float sigmaPixels) {
  const float variance = worldUnits(s, sigmaPixels) * worldUnits(s, sigmaPixels);
  splat::SplatCloud cloud;
  for (const auto& [x, y] : pixels) {
    cloud.positions.insert(cloud.positions.end(), {worldUnits(s, x), worldUnits(s, y), -kDepth});
    cloud.covariances.insert(cloud.covariances.end(), {variance, 0, 0, variance, 0, variance});
    cloud.colors.insert(cloud.colors.end(), {1, 0, 0});
    cloud.alphas.push_back(1);
  }
  return cloud;
}
// Byte offset of the pixel `x`, `y` from the image centre, +y up.
size_t pixelAt(float x, float y) {
  const auto column = static_cast<size_t>(kExtent.width / 2.0f + x);
  const auto row = static_cast<size_t>(kExtent.height / 2.0f - y);
  return (row * kExtent.width + column) * 4;
}
bool samePixel(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b, size_t pixel) {
  for (size_t c = 0; c < 4; ++c)
    if (a[pixel + c] != b[pixel + c]) return false;
  return true;
}
bool blank(const std::vector<uint8_t>& rgba) {
  return std::all_of(rgba.begin(), rgba.end(), [](uint8_t v) { return v == 0; });
}
// A pure green glow at full strength, the level `level` world units above the centre.
RevealUniform greenReveal(float level, float band) {
  RevealUniform reveal;
  reveal.level = level;
  reveal.band = band;
  reveal.tintAmount = 1;
  reveal.brightnessBoost = 0;
  reveal.tint[0] = 0;
  reveal.tint[1] = 1;
  reveal.tint[2] = 0;
  return reveal;
}

// splat.vert applies the reveal on the CPU-order path: under the level the splat is gone, at
// it the splat takes the glow, and idle draws it as before.
void testCpuOrderReveal(const Gpu& gpu, const Scene& s) {
  auto world = VulkanWorld::upload(*gpu.context, cloudAt(s, {{0, 0}}, kSigmaPixels), 0, true);
  require(world != nullptr, "reveal world upload");
  s.pipeline->bindWorld(*world);
  const uint32_t order = 0;
  const auto frame = [&](const RevealUniform& reveal) {
    return renderRgba(
        gpu, s, [&](VkCommandBuffer cmd) { world->recordOrderUpload(cmd, 0, &order, 1); },
        [&](VkCommandBuffer cmd) { s.pipeline->draw(cmd, 0, *world, 1, 0); }, 0, 0, reveal);
  };
  const size_t centre = pixelAt(0, 0);
  const auto reference = frame({});
  require(reference[centre] > 200 && reference[centre + 1] == 0, "unrevealed splat is red");
  require(blank(frame(greenReveal(-worldUnits(s, 1), 1))), "a level under the splat hides it");
  const auto glowing = frame(greenReveal(0, 1));
  require(glowing[centre] <= kTolerance &&
              std::abs(glowing[centre + 1] - reference[centre]) <= kTolerance,
          "a splat at the level takes the full glow");
  require(frame({}) == reference, "an idle reveal draws the unrevealed image");
  std::puts("PASS the CPU-order draw clips and tints at the reveal level and idles unchanged");
}

// A labelled world drawn the way VulkanSplatRenderer::draw does with GPU order: camera upload,
// style upload, visibility, sort, then the indirect projected draw.
struct LabelledFrame {
  LabelledFrame(const Gpu& gpu, const Scene& s, const splat::SplatCloud& cloud) : gpu(gpu), s(s) {
    world = VulkanWorld::upload(*gpu.context, cloud, 0, false);
    require(world && world->labels, "labelled world upload");
    auto pipelines = VulkanFrameCompute::Pipelines::compile(*gpu.context);
    require(pipelines.has_value(), "frame pipelines");
    pipelines->visibility = VulkanVisibilityPass::Pipelines::compile(*gpu.context, true);
    require(pipelines->visibility != nullptr, "labelled visibility pipelines");
    auto created = VulkanFrameCompute::create(*gpu.context, *pipelines, world->count);
    require(static_cast<bool>(created), "labelled frame compute");
    compute = std::move(created.value());
    range = {0, world->count};
  }
  std::vector<uint8_t> draw(uint32_t slot, const splatkit::LabelStyles* styles,
                            const RevealUniform& reveal = {}) {
    std::optional<VulkanFrameCompute::Draw> drawn;
    auto image = renderRgba(
        gpu, s,
        [&](VkCommandBuffer cmd) {
          world->updateStyles(slot, styles);
          SplatRenderer::Frame frame;
          frame.orderSource = SplatRenderer::OrderSource::gpu;
          frame.ranges = &range;
          frame.rangeCount = 1;
          frame.labelStyles = styles;
          frame.reveal = reveal;
          drawn = compute->encode(cmd, slot, s.cameras->buffer(slot), *world->splats, *world->sh, 0,
                                  frame, world->labels.get(), world->styles[slot].get());
          require(drawn.has_value(), "labelled frame encode");
          s.pipeline->bindProjected(slot, drawn->projected, drawn->order, drawn->capacity);
        },
        [&](VkCommandBuffer cmd) { s.pipeline->drawProjected(cmd, slot, drawn->arguments); }, 0,
        slot, reveal);
    require(compute->stats().status == 0, "no frame failure");
    return image;
  }
  const Gpu& gpu;
  const Scene& s;
  std::unique_ptr<VulkanWorld> world;
  std::unique_ptr<VulkanFrameCompute> compute;
  SplatRenderer::Range range{};
};

// The channel a style of tint `tint`, amount `amount` and brightness `brightness` gives a red
// splat, scaled by the reference frame's coverage at that pixel.
int expectedChannel(uint8_t referenceRed, float red, float tint, float amount, float brightness) {
  const float styled = std::min((red + (tint - red) * amount) * brightness, 1.0f);
  return static_cast<int>(std::lround(referenceRed * styled));
}
void requireChannel(int got, int expected, const char* what) {
  if (std::abs(got - expected) > kTolerance) {
    std::fprintf(stderr, "%s: got %d, expected %d\n", what, got, expected);
    require(false, what);
  }
}

// Part A sits upper left, part B lower right. Highlighting B tints it and dims A; hiding B
// removes it; the reveal hides A above the level and tints B in its band; the idle frame comes
// back identical. The style uploads that change only states or only the palette reach the GPU.
void testLabelledFrame(const Gpu& gpu, const Scene& s) {
  constexpr float kPartOffset = 16;  // pixels from the centre on both axes
  constexpr float kPartSigma = 3;
  constexpr uint16_t kPartA = 0;
  constexpr uint16_t kPartB = 1;
  constexpr uint32_t kHiddenState = 1;
  auto cloud = cloudAt(s, {{-kPartOffset, kPartOffset}, {kPartOffset, -kPartOffset}}, kPartSigma);
  cloud.labels = {kPartA, kPartB};
  LabelledFrame frame(gpu, s, cloud);
  const size_t a = pixelAt(-kPartOffset, kPartOffset);
  const size_t b = pixelAt(kPartOffset, -kPartOffset);

  const auto reference = frame.draw(0, nullptr);
  require(
      reference[a] > 200 && reference[b] > 200 && reference[a + 1] == 0 && reference[b + 1] == 0,
      "both parts drawn red");

  splatkit::Highlight highlight(2);
  highlight.set(&kPartB, 1);
  highlight.update(splatkit::Highlight::kFadeSeconds);
  const auto highlighted = frame.draw(1, &highlight.styles());
  const splatkit::HighlightLook look;
  const auto& tint = look.tint;
  const float amount = look.tintAmount;
  const float emphasis = look.partBrightness;
  requireChannel(highlighted[a], expectedChannel(reference[a], 1, 0, 0, look.otherBrightness),
                 "the other part dims");
  for (int c = 0; c < 3; ++c)
    requireChannel(highlighted[b + c],
                   expectedChannel(reference[b], c == 0 ? 1 : 0, tint[c], amount, emphasis),
                   "the highlighted part takes the emphasis");

  // One table on one slot: first both parts plain under a palette with a hidden state, then a
  // states-only upload hides B, then a palette-only upload turns the hidden state green.
  splatkit::LabelStyles styles(2);
  auto palette = styles.palette();
  palette[kHiddenState].opacity = 0;
  styles.setPalette(palette);
  require(frame.draw(0, &styles) == reference, "an unused hidden state changes nothing");
  styles.setStates({0, kHiddenState});
  const auto hidden = frame.draw(0, &styles);
  require(frame.world->styleUploadOffset(0) == splatkit::kPaletteBytes &&
              frame.world->styleUploadBytes(0) == 2 * sizeof(uint32_t),
          "a membership change uploads the states only");
  require(samePixel(hidden, reference, a) && hidden[b] == 0 && hidden[b + 3] == 0,
          "the GPU reads the new states over the kept palette: B is hidden, A unchanged");
  palette[kHiddenState].opacity = 1;
  palette[kHiddenState].tint[1] = 1;
  palette[kHiddenState].tintAmount = 1;
  styles.setPalette(palette);
  const auto recoloured = frame.draw(0, &styles);
  require(frame.world->styleUploadOffset(0) == 0 &&
              frame.world->styleUploadBytes(0) == splatkit::kPaletteBytes,
          "a palette change uploads the palette only");
  requireChannel(recoloured[b], 0, "the GPU reads the new palette over the kept states");
  requireChannel(recoloured[b + 1], reference[b], "the recoloured part is green");

  // The level sits between the parts; B, kPartOffset under the centre, glows in its band.
  const float level = 0;
  const float band = worldUnits(s, 2 * kPartOffset);
  const auto reveal = greenReveal(level, band);
  const float ramp = 1 - (level + worldUnits(s, kPartOffset)) / band;
  const float glow = ramp * ramp;
  for (const uint32_t slot : {0u, 1u}) {
    const auto revealed = frame.draw(slot, nullptr, reveal);
    require(revealed[a] == 0 && revealed[a + 3] == 0, "the reveal hides the part above the level");
    requireChannel(revealed[b], expectedChannel(reference[b], 1, 0, glow, 1),
                   "the part in the band loses red to the glow");
    requireChannel(revealed[b + 1], expectedChannel(reference[b], 0, 1, glow, 1),
                   "the part in the band gains the glow");
    require(frame.draw(slot, nullptr, reveal) == revealed, "an unchanged reveal draws the same");
  }
  palette[kHiddenState] = {};
  palette[kHiddenState].opacity = 0;
  styles.setPalette(palette);
  require(blank(frame.draw(0, &styles, reveal)), "the reveal and a hidden part leave nothing");
  for (const uint32_t slot : {0u, 1u})
    require(frame.draw(slot, nullptr) == reference, "an idle frame matches the first one");
  std::puts("PASS a labelled GPU-order frame highlights, hides, reveals and restores its parts");
}
}  // namespace

int main() {
  try {
    Gpu gpu;
    std::printf("GPU: %s\n", gpu.context->deviceDescription().c_str());
    const Scene s = scene(gpu);
    testCameraRejection(s);
    testTranslucent(gpu, s);
    testLodCore(gpu, s);
    testCpuOrderCutoff(gpu, s);
    testProjectedPath(gpu, s);
    testCpuOrderReveal(gpu, s);
    testLabelledFrame(gpu, s);
    gpu.requireValidationClean();
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL: %s\n", error.what());
    return 1;
  }
}

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <vector>

#include "rendering/vulkan/frame/VulkanCameraUniforms.h"
#include "rendering/vulkan/presentation/VulkanRenderTarget.h"
#include "rendering/vulkan/raster/VulkanSplatPipeline.h"
#include "splat/math/Half.h"
#include "splatkit/rendering/GpuLayout.h"
#include "support/VulkanTestContext.h"

namespace {
using splatkit::ProjectedSplat;
using splatkit::VulkanBuffer;
using splatkit::VulkanCameraUniforms;
using splatkit::VulkanRenderTarget;
using splatkit::VulkanSplatPipeline;
namespace test = splatkit::test;
using test::require;
using Gpu = test::VulkanTestContext;

constexpr VkExtent2D kExtent{64, 64};
constexpr VkFormat kFormat = VK_FORMAT_R8G8B8A8_UNORM;
constexpr float kDepth = 5;
constexpr float kSigmaPixels = 8;
// The projection's low-pass filter adds this to the projected variance (splat_projection.glsl).
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

using Record = std::function<void(VkCommandBuffer)>;

// The red channel of what `before` and `draw` record, over transparent black: `before` runs
// outside the render pass, `draw` inside it. `minPixelRadius` is the camera's cutoff.
std::vector<uint8_t> render(const Gpu& gpu, const Scene& s, const Record& before,
                            const Record& draw, float minPixelRadius = 0) {
  s.cameras->update(0, splat::Mat4::identity(), s.proj, {0, 0, 0}, kExtent, false, 0,
                    minPixelRadius);
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
  std::vector<uint8_t> red(kExtent.width * kExtent.height);
  for (size_t i = 0; i < red.size(); ++i) red[i] = rgba[i * 4];
  return red;
}

uint32_t packHalves(float low, float high) {
  return splat::toHalf(low) | (static_cast<uint32_t>(splat::toHalf(high)) << 16);
}

// One white splat at the centre of the view as a projected record, as the visibility pass writes
// it, drawn indirectly.
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

void testProjectedPath(const Gpu& gpu, const Scene& s) {
  requireGaussian(renderProjected(gpu, s, 0.8f, 2.5f), 0.8f, 2.5f);
  const float alpha = 3;
  const float radius = std::sqrt(2 * std::log(alpha * 255 / 2));
  requireGaussian(renderProjected(gpu, s, alpha, radius), alpha, radius);
  std::puts("PASS projected records draw the Gaussian out to the quad's radius");
}
}  // namespace

int main() {
  try {
    Gpu gpu;
    std::printf("GPU: %s\n", gpu.context->deviceDescription().c_str());
    const Scene s = scene(gpu);
    testProjectedPath(gpu, s);
    gpu.requireValidationClean();
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL: %s\n", error.what());
    return 1;
  }
}

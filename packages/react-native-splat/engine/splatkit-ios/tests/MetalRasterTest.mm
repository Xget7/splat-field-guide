#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "rendering/MetalSplatRenderer.h"
#include "splat/formats/SpzDecoder.h"
#include "splat/io/MappedFile.h"
#include "splat/sorting/SpatialOrder.h"
#include "splatkit/camera/OrbitCamera.h"
#include "splatkit/highlight/Highlight.h"

namespace splatkit {
namespace {

constexpr int64_t kCaptureTimeoutNanos = 30 * NSEC_PER_SEC;

// One red splat 2 m in front of a camera at the origin.
splat::SplatCloud redSplat() {
  splat::SplatCloud cloud;
  cloud.positions = {0, 0, -2};
  cloud.colors = {1, 0, 0};
  cloud.alphas = {1};
  cloud.covariances = {0.04f, 0, 0, 0.04f, 0, 0.04f};
  return cloud;
}

class MetalRasterTest : public testing::Test {
 protected:
  void SetUp() override {
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    if (device == nil || ![device supportsFamily:MTLGPUFamilyApple7])
      GTEST_SKIP() << "Apple GPU family 7 unavailable; renderer validation requires A14/M1+";
    renderer = MetalSplatRenderer::create();
    ASSERT_NE(renderer, nullptr);
  }

  void attach(uint32_t width, uint32_t height) {
    CAMetalLayer* layer = [CAMetalLayer layer];
    layer.drawableSize = CGSizeMake(width, height);
    renderer->setLayer(layer);
    renderer->setDrawableSize(width, height);
  }

  // Captured pixels use BGRA with top-down rows.
  std::vector<uint8_t> drawAndCapture(const SplatRenderer::Frame& frame) {
    dispatch_semaphore_t captured = dispatch_semaphore_create(0);
    std::vector<uint8_t> pixels;
    renderer->captureNextFrame([&](std::vector<uint8_t> image, uint32_t, uint32_t) {
      pixels = std::move(image);
      dispatch_semaphore_signal(captured);
    });
    EXPECT_TRUE(renderer->draw(frame));
    EXPECT_EQ(dispatch_semaphore_wait(captured,
                                      dispatch_time(DISPATCH_TIME_NOW, kCaptureTimeoutNanos)),
              0);
    return pixels;
  }

  std::unique_ptr<MetalSplatRenderer> renderer;
};

TEST_F(MetalRasterTest, AWorldFrameCompletesOnlyAfterTheGpuDrawsIt) {
  attach(64, 64);
  drawAndCapture({});
  EXPECT_FALSE(renderer->hasCompletedWorldFrame());
  SplatRenderer::Frame frame;
  frame.proj = splat::Mat4::perspective(1, 1, 0.1f, 100);
  for (int replacement = 0; replacement < 2; ++replacement) {
    ASSERT_TRUE(renderer->uploadWorld(redSplat(), 0));
    EXPECT_FALSE(renderer->hasCompletedWorldFrame());
    drawAndCapture(frame);
    EXPECT_TRUE(renderer->hasCompletedWorldFrame());
  }
}

TEST_F(MetalRasterTest, ASplatReachesThePresentedPixels) {
  attach(64, 64);
  ASSERT_TRUE(renderer->uploadWorld(redSplat(), 0));
  SplatRenderer::Frame frame;
  frame.proj = splat::Mat4::perspective(1, 1, 0.1f, 100);
  const auto pixels = drawAndCapture(frame);
  ASSERT_EQ(pixels.size(), 64u * 64u * 4u);
  const size_t center = (32 * 64 + 32) * 4;
  EXPECT_GT(pixels[center + 2], 200);  // red, not the background
  EXPECT_LT(pixels[center + 1], 20);
  EXPECT_EQ(renderer->lastDrawCount(), 1u);
}

TEST_F(MetalRasterTest, TheBackdropTakesTheCapturesColourAndIsBlackWithoutOne) {
  constexpr size_t kCorner = 0;    // BGRA of the top-left pixel, far from the splat
  constexpr uint8_t kDither = 1;   // the composite's dither moves a channel by at most this
  constexpr uint8_t kTinted = 30;  // how far red must lead green to read as the capture's colour
  attach(64, 64);
  SplatRenderer::Frame frame;
  frame.proj = splat::Mat4::perspective(1, 1, 0.1f, 100);
  const auto empty = drawAndCapture(frame);
  EXPECT_LE(empty[kCorner + 2], kDither);
  ASSERT_TRUE(renderer->uploadWorld(redSplat(), 0));
  const auto filled = drawAndCapture(frame);
  EXPECT_GT(filled[kCorner + 2], filled[kCorner + 1] + kTinted);
  EXPECT_GT(filled[kCorner + 2], filled[kCorner] + kTinted);
}

TEST_F(MetalRasterTest, AHighlightTintsItsPartAndDimsTheRest) {
  constexpr uint8_t kPart = 3;
  constexpr uint8_t kOtherPart = 4;
  constexpr size_t kCenter = (32 * 64 + 32) * 4;  // BGRA
  attach(64, 64);
  auto cloud = redSplat();
  cloud.labels = {kPart};
  ASSERT_TRUE(renderer->uploadWorld(cloud, 0));
  SplatRenderer::Frame frame;
  frame.proj = splat::Mat4::perspective(1, 1, 0.1f, 100);
  const auto asCaptured = drawAndCapture(frame);

  Highlight highlight;
  highlight.set(&kPart, 1);
  highlight.update(Highlight::kFadeSeconds);
  frame.labelStyles = &highlight.styles();
  const auto emphasised = drawAndCapture(frame);
  highlight.set(&kOtherPart, 1);
  highlight.update(Highlight::kFadeSeconds);
  const auto dimmed = drawAndCapture(frame);

  EXPECT_LT(asCaptured[kCenter], 20);
  EXPECT_GT(emphasised[kCenter], asCaptured[kCenter] + 20);
  EXPECT_GE(emphasised[kCenter + 2], asCaptured[kCenter + 2]);
  EXPECT_LT(dimmed[kCenter + 2], asCaptured[kCenter + 2] * 0.7f);
  EXPECT_GT(dimmed[kCenter + 2], asCaptured[kCenter + 2] * 0.4f);
  EXPECT_LT(dimmed[kCenter], 20);
}

TEST_F(MetalRasterTest, ARealWorldFillsTheView) {
  const char* path = std::getenv("SPLAT_SPZ_PATH");
  if (!path) GTEST_SKIP() << "Set SPLAT_SPZ_PATH to an SPZ capture";
  auto file = splat::MappedFile::open(path);
  ASSERT_TRUE(file);
  splat::SpzDecodeOptions options;
  options.maxShDegree = 1;
  auto decoded = splat::decodeSpz(file.value().data(), file.value().size(), options);
  ASSERT_TRUE(decoded);
  auto& cloud = decoded.value();
  splat::reorderSpatially(cloud);

  constexpr uint32_t kWidth = 1206;
  constexpr uint32_t kHeight = 2622;
  attach(kWidth, kHeight);
  ASSERT_TRUE(renderer->draw({}));
  ASSERT_TRUE(renderer->uploadWorld(cloud, 1));
  const splat::Bounds& b = cloud.bounds;
  OrbitCamera camera;
  OrbitPose pose;
  pose.target = {(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2};
  pose.radius = splat::length({b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]});
  ASSERT_TRUE(camera.setPose(pose));
  SplatRenderer::Frame frame;
  frame.view = camera.viewMatrix();
  frame.cameraPosition = camera.position();
  frame.proj = splat::Mat4::perspective(65.0f * 3.14159265f / 180.0f,
                                        static_cast<float>(kWidth) / kHeight, 0.05f, 200);
  frame.shDegree = 1;
  for (int iteration = 0; iteration < 3; ++iteration) {
    const auto pixels = drawAndCapture(frame);
    uint32_t visiblePixels = 0;
    for (size_t i = 0; i < pixels.size(); i += 4) {
      if (pixels[i] > 40 || pixels[i + 1] > 40 || pixels[i + 2] > 40) ++visiblePixels;
    }
    printf("[ world ] %u visible pixels, %u splats, %.2f ms compute, %.2f ms raster\n",
           visiblePixels, renderer->lastDrawCount(), renderer->lastSortMillis(),
           renderer->lastGpuMillis());
    EXPECT_GT(visiblePixels, 10000u);
  }
}

}
}

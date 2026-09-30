#import <Metal/Metal.h>

#include <gtest/gtest.h>

#include <vector>

#include "MetalTestContext.h"
#include "rendering/MetalVisibility.h"
#include "splat/math/Half.h"
#include "splat/math/Mat4.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {
namespace {

using test::Gpu;

// A splat with a unit isotropic covariance: a real footprint at a few metres.
GpuSplat unitSplat(float x, float y, float z) {
  GpuSplat splat{};
  splat.position[0] = x;
  splat.position[1] = y;
  splat.position[2] = z;
  splat.rgba8 = 0xffffffffu;
  const uint32_t one = splat::toHalf(1.0f);
  splat.cov[0] = one;
  splat.cov[1] = one << 16;
  splat.cov[2] = one << 16;
  return splat;
}

id<MTLBuffer> splatBuffer(const std::vector<GpuSplat>& splats) {
  return [Gpu::get().device newBufferWithBytes:splats.data()
                                        length:splats.size() * sizeof(GpuSplat)
                                       options:MTLResourceStorageModeShared];
}

// At the origin looking down -z, one radian of field of view, 1000 pixels square.
id<MTLBuffer> cameraAtOrigin() {
  CameraUniform u{};
  u.view = splat::Mat4::identity();
  u.proj = splat::Mat4::perspective(1.0f, 1.0f, 0.1f, 100.0f);
  u.focal[0] = u.focal[1] = 500;
  u.tanHalfFov[0] = u.tanHalfFov[1] = 1;
  u.screenSize[0] = u.screenSize[1] = 1000;
  return [Gpu::get().device newBufferWithBytes:&u length:sizeof(u) options:MTLResourceStorageModeShared];
}

id<MTLBuffer> styleBuffer(const LabelStyles& styles) {
  return [Gpu::get().device newBufferWithBytes:styles.data()
                                        length:sizeof(styles)
                                       options:MTLResourceStorageModeShared];
}

float halfAt(uint32_t packed, int which) {
  return splat::fromHalf(static_cast<uint16_t>(packed >> (16 * which)));
}

class MetalVisibilityTest : public ::testing::Test {
 protected:
  void SetUp() override {
    ASSERT_NE(Gpu::get().device, nil);
    ASSERT_NE(Gpu::get().library, nil);
    ASSERT_TRUE(visibility.create(Gpu::get().device, Gpu::get().library));
  }

  void run(uint32_t slot, id<MTLBuffer> splats, uint32_t count) {
    id<MTLCommandBuffer> cmd = [Gpu::get().queue commandBuffer];
    ASSERT_TRUE(visibility.encode(cmd, slot, uniforms, styles, splats, nil, 0, count));
    [cmd commit];
    [cmd waitUntilCompleted];
    ASSERT_EQ(cmd.status, MTLCommandBufferStatusCompleted);
  }

  // The source indices of the sorted survivors of `slot`, nearest first.
  std::vector<uint32_t> drawn(uint32_t slot) const {
    const auto* order = static_cast<const uint32_t*>(visibility.order().contents);
    const auto* projected = static_cast<const ProjectedSplat*>(visibility.projected().contents);
    std::vector<uint32_t> indices;
    for (uint32_t i = 0; i < visibility.count(slot); ++i) indices.push_back(projected[order[i]].index);
    return indices;
  }

  // Checks that the batches partition the survivors, in order.
  void expectBatchesCover(uint32_t slot, uint32_t survivors) const {
    const auto* draws = static_cast<const MTLDrawPrimitivesIndirectArguments*>(
        visibility.drawArguments(slot).contents);
    uint32_t next = 0;
    for (uint32_t b = 0; b < MetalVisibility::kDrawBatches; ++b) {
      EXPECT_EQ(draws[b].vertexCount, 4u);
      EXPECT_EQ(draws[b].vertexStart, 0u);
      EXPECT_EQ(draws[b].baseInstance, next);
      next += draws[b].instanceCount;
    }
    EXPECT_EQ(next, survivors);
  }

  MetalVisibility visibility;
  id<MTLBuffer> uniforms = cameraAtOrigin();
  id<MTLBuffer> styles = styleBuffer(LabelStyles{});
};

TEST_F(MetalVisibilityTest, ProjectsEverySplatOfALargeWorldOnce) {
  const uint32_t n = 2000003;
  id<MTLBuffer> splats = splatBuffer(std::vector<GpuSplat>(n, unitSplat(0, 0, -2)));
  ASSERT_TRUE(visibility.reserve(n));
  run(0, splats, n);
  ASSERT_EQ(visibility.count(0), n);
  const auto* projected = static_cast<const ProjectedSplat*>(visibility.projected().contents);
  std::vector<bool> seen(n, false);
  for (uint32_t i = 0; i < n; ++i) {
    ASSERT_LT(projected[i].index, n);
    ASSERT_FALSE(seen[projected[i].index]);
    seen[projected[i].index] = true;
  }
}

TEST_F(MetalVisibilityTest, AnEmptyFrameClearsThePreviousDraws) {
  id<MTLBuffer> splats = splatBuffer(std::vector<GpuSplat>(8, unitSplat(0, 0, -2)));
  ASSERT_TRUE(visibility.reserve(8));
  run(0, splats, 8);
  EXPECT_EQ(visibility.count(0), 8u);
  run(0, splats, 0);
  EXPECT_EQ(visibility.count(0), 0u);
  expectBatchesCover(0, 0);
}

TEST_F(MetalVisibilityTest, RefusesACountAboveCapacityOrABadSlot) {
  id<MTLBuffer> splats = splatBuffer(std::vector<GpuSplat>(4, unitSplat(0, 0, -2)));
  id<MTLCommandBuffer> cmd = [Gpu::get().queue commandBuffer];
  EXPECT_FALSE(visibility.encode(cmd, 0, uniforms, styles, splats, nil, 0, 1));  // not reserved
  ASSERT_TRUE(visibility.reserve(4));
  EXPECT_FALSE(visibility.encode(cmd, 0, uniforms, styles, splats, nil, 0, 5));
  EXPECT_FALSE(
      visibility.encode(cmd, MetalVisibility::kSlots, uniforms, styles, splats, nil, 0, 4));
}

TEST_F(MetalVisibilityTest, CullsAndOrdersTheSplatsFrontToBack) {
  // 0: 10 m ahead, 1: behind, 2: 2 m ahead, 3: far to the side, 4: 5 m ahead,
  // 5: past the count.
  id<MTLBuffer> splats =
      splatBuffer({unitSplat(0, 0, -10), unitSplat(0, 0, 5), unitSplat(0, 0, -2),
                   unitSplat(50, 0, -1), unitSplat(0, 0, -5), unitSplat(0, 0, -3)});
  ASSERT_TRUE(visibility.reserve(6));
  run(1, splats, 5);
  EXPECT_EQ(drawn(1), (std::vector<uint32_t>{2, 4, 0}));
  expectBatchesCover(1, 3);
}

TEST_F(MetalVisibilityTest, DropsASubpixelGaussianBeforeSorting) {
  GpuSplat tiny = unitSplat(0, 0, -2);
  const uint32_t small = splat::toHalf(1.0e-8f);
  tiny.cov[0] = small;
  tiny.cov[1] = small << 16;
  tiny.cov[2] = small << 16;
  id<MTLBuffer> splats = splatBuffer({unitSplat(0, 0, -2), tiny});
  ASSERT_TRUE(visibility.reserve(2));
  run(0, splats, 2);
  EXPECT_EQ(drawn(0), (std::vector<uint32_t>{0}));
}

// Each splat is drawn in its part label's style: tinted, dimmed, or culled when the
// style makes it transparent.
TEST_F(MetalVisibilityTest, EachSplatTakesItsLabelsStyle) {
  std::vector<GpuSplat> source(4, unitSplat(0, 0, -2));
  source[0].rgba8 = 0xff0000ffu;  // opaque red, unlabelled and as captured
  source[1].rgba8 = 0xff0000ffu;
  source[1].partLabel = 1;  // fully tinted blue
  source[2].rgba8 = 0xff0000ffu;
  source[2].partLabel = 2;  // dimmed to a quarter
  source[3].partLabel = 3;  // transparent
  LabelStyles table{};
  table[1].tint[2] = 1;
  table[1].tintAmount = 1;
  table[2].brightness = 0.25f;
  table[3].opacity = 0;
  styles = styleBuffer(table);
  id<MTLBuffer> splats = splatBuffer(source);
  ASSERT_TRUE(visibility.reserve(4));
  run(0, splats, 4);
  ASSERT_EQ(visibility.count(0), 3u);
  const auto* projected = static_cast<const ProjectedSplat*>(visibility.projected().contents);
  for (uint32_t i = 0; i < 3; ++i) {
    const ProjectedSplat& p = projected[i];
    SCOPED_TRACE(p.index);
    const float red = halfAt(p.color0, 0);
    const float blue = halfAt(p.color1, 0);
    const float alpha = halfAt(p.color1, 1);
    EXPECT_EQ(alpha, 1.0f);
    if (p.index == 0) {
      EXPECT_EQ(red, 1.0f);
      EXPECT_EQ(blue, 0.0f);
    } else if (p.index == 1) {
      EXPECT_EQ(red, 0.0f);
      EXPECT_EQ(blue, 1.0f);
    } else {
      EXPECT_EQ(p.index, 2u);
      EXPECT_EQ(red, 0.25f);
    }
  }
}

// Survivors are ranked within SIMD groups of 32 and threadgroups of 256: every tail
// length must compact without losing or repeating a splat.
TEST_F(MetalVisibilityTest, CompactsPartialSimdGroupsAndReusesSlots) {
  constexpr uint32_t capacity = 513;
  std::vector<GpuSplat> source(capacity, unitSplat(0, 0, -2));
  for (uint32_t i = 0; i < capacity; i += 3) source[i].position[2] = 2;  // behind
  id<MTLBuffer> splats = splatBuffer(source);
  ASSERT_TRUE(visibility.reserve(capacity));
  for (uint32_t n : {1u, 31u, 32u, 33u, 255u, 256u, 257u, 513u, 0u}) {
    SCOPED_TRACE(n);
    const uint32_t slot = n % MetalVisibility::kSlots;
    run(slot, splats, n);
    const uint32_t expected = n - (n + 2) / 3;
    const auto indices = drawn(slot);
    ASSERT_EQ(indices.size(), expected);
    std::vector<bool> seen(n, false);
    for (const uint32_t index : indices) {
      ASSERT_LT(index, n);
      EXPECT_NE(index % 3, 0u);
      EXPECT_FALSE(seen[index]);
      seen[index] = true;
    }
    expectBatchesCover(slot, expected);
  }
}

}  // namespace
}  // namespace splatkit

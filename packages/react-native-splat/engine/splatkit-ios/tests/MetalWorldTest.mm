#include <gtest/gtest.h>

#include <cstring>

#include <cstdint>
#include <vector>

#include "rendering/metal/world/MetalWorld.h"
#include "splatkit/guide/GuideLayout.h"
#include "splatkit/rendering/GpuLayout.h"
#include "support/MetalTestContext.h"

namespace splatkit {
namespace {

splat::SplatCloud cloud() {
  splat::SplatCloud c;
  c.positions = {1, 2, -3, 4, 5, -6};
  c.covariances = {1, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 2};
  c.colors = {1, 0, 0, 0, 1, 0};
  c.alphas = {1, 0.5f};
  return c;
}

TEST(MetalWorldTest, ADrawDegreeNeverExceedsTheWorldOrTheShaders) {
  auto& gpu = test::Gpu::get();
  auto world = MetalWorld::slab(gpu.device, 4, 2);
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->drawDegree(-1), 0);
  EXPECT_EQ(world->drawDegree(1), 1);
  EXPECT_EQ(world->drawDegree(2), 2);
  EXPECT_EQ(world->drawDegree(3), 2);
  EXPECT_EQ(world->drawDegree(99), 2);
}

TEST(MetalWorldTest, SharedUploadMatchesCorePackingAndAcceptsCpuOrder) {
  auto& gpu = test::Gpu::get();
  const auto source = cloud();
  auto world = MetalWorld::upload(gpu.device, source, 3);
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->info().count, 2u);
  EXPECT_EQ(world->info().shDegree, 0);
  EXPECT_EQ(world->splats().storageMode, MTLStorageModeShared);
  EXPECT_EQ(world->order(), nil);
  const auto packed = packSplats(source);
  const size_t bytes = packed.size() * sizeof(GpuSplat);
  EXPECT_EQ(std::memcmp(world->splats().contents, packed.data(), bytes), 0);
  const uint32_t order[2] = {1, 0};
  ASSERT_TRUE(world->writeOrder(order, 2));
  id<MTLBuffer> previous = world->order();
  EXPECT_EQ(std::memcmp(previous.contents, order, sizeof(order)), 0);
  const uint32_t next[2] = {0, 1};
  ASSERT_TRUE(world->writeOrder(next, 2));
  EXPECT_NE(world->order(), previous);
  EXPECT_EQ(std::memcmp(previous.contents, order, sizeof(order)), 0);
  EXPECT_FALSE(world->uploadTile(0, source));
}

TEST(MetalWorldTest, TileUpdatesStayInTheirSlabRangeAndClearMissingHarmonics) {
  auto& gpu = test::Gpu::get();
  auto world = MetalWorld::slab(gpu.device, 4, 1);
  ASSERT_NE(world, nullptr);
  const auto source = cloud();
  std::memset(world->splats().contents, 0, world->splats().length);
  std::memset(world->harmonics().contents, 0xff, world->harmonics().length);
  ASSERT_TRUE(world->uploadTile(1, source));
  const auto* records = static_cast<const GpuSplat*>(world->splats().contents);
  EXPECT_FLOAT_EQ(records[0].position[0], 0);
  EXPECT_FLOAT_EQ(records[1].position[0], 1);
  EXPECT_FLOAT_EQ(records[2].position[0], 4);
  EXPECT_FLOAT_EQ(records[3].position[0], 0);
  const auto* sh = static_cast<const uint32_t*>(world->harmonics().contents);
  const size_t stride = shStride(1);
  EXPECT_EQ(sh[0], 0xffffffffu);
  for (size_t i = stride; i < stride * 3; ++i) EXPECT_EQ(sh[i], 0u);
  EXPECT_EQ(sh[stride * 3], 0xffffffffu);
  EXPECT_FALSE(world->uploadTile(3, source));
  EXPECT_FLOAT_EQ(records[3].position[0], 0);
}

TEST(MetalWorldTest, EmptyUploadsAndInvalidRequestsHaveDefinedOutcomes) {
  auto& gpu = test::Gpu::get();
  auto world = MetalWorld::upload(gpu.device, {}, 0);
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->info().count, 0u);
  EXPECT_TRUE(world->writeOrder(nullptr, 0));
  EXPECT_FALSE(world->writeOrder(nullptr, 1));
  EXPECT_EQ(MetalWorld::slab(gpu.device, 0, 0), nullptr);
  auto malformed = cloud();
  malformed.alphas.clear();
  EXPECT_EQ(MetalWorld::upload(gpu.device, malformed, 0), nullptr);
}

TEST(MetalWorldTest, ChunkedUploadPreservesSHAndRecordsAcrossStagingBoundary) {
  auto& gpu = test::Gpu::get();
  splat::SplatCloud source;
  source.shDegree = 1;
  for (uint32_t i = 0; i < 65539; ++i) {
    source.positions.insert(source.positions.end(), {static_cast<float>(i), 0, -2});
    source.covariances.insert(source.covariances.end(), {0.01f, 0, 0, 0.02f, 0, 0.03f});
    source.colors.insert(source.colors.end(), {1, 0, 0});
    source.alphas.push_back(i == 65536 ? 2.0f : 0.5f);
    for (int j = 0; j < 9; ++j) source.sh.push_back(static_cast<float>((i + j) % 17) / 32);
  }
  auto world = MetalWorld::upload(gpu.device, source, 1);
  ASSERT_TRUE(world);
  const auto packed = packSplats(source);
  const auto harmonics = packSh(source, 1);
  const size_t bytes = packed.size() * sizeof(GpuSplat);
  const size_t shBytes = harmonics.size() * 4;
  auto readback = [gpu.device newBufferWithLength:bytes + shBytes
                                          options:MTLResourceStorageModeShared];
  auto command = [gpu.queue commandBuffer];
  auto blit = [command blitCommandEncoder];
  [blit copyFromBuffer:world->splats()
           sourceOffset:0
               toBuffer:readback
      destinationOffset:0
                   size:bytes];
  [blit copyFromBuffer:world->harmonics()
           sourceOffset:0
               toBuffer:readback
      destinationOffset:bytes
                   size:shBytes];
  [blit endEncoding];
  [command commit];
  [command waitUntilCompleted];
  ASSERT_EQ(command.status, MTLCommandBufferStatusCompleted);
  EXPECT_EQ(std::memcmp(readback.contents, packed.data(), bytes), 0);
  EXPECT_EQ(
      std::memcmp(static_cast<uint8_t*>(readback.contents) + bytes, harmonics.data(), shBytes), 0);
}

// The label stream every frame of the world reads beside its records.
std::vector<uint32_t> labelWords(id<MTLBuffer> labels, size_t words) {
  std::vector<uint32_t> out(words);
  std::memcpy(out.data(), labels.contents, words * sizeof(uint32_t));
  return out;
}

TEST(MetalWorldTest, ReplacingTheWorldKeepsEachWorldsLabels) {
  auto& gpu = test::Gpu::get();
  auto first = cloud();
  first.labels = {3, 7};
  auto second = cloud();
  second.labels = {9, 4};
  auto a = MetalWorld::upload(gpu.device, first, 0);
  auto b = MetalWorld::upload(gpu.device, second, 0);
  ASSERT_NE(a, nullptr);
  ASSERT_NE(b, nullptr);
  ASSERT_NE(a->labels(), nil);
  ASSERT_NE(a->labels(), b->labels());
  EXPECT_EQ(labelWords(a->labels(), 1), packLabels(first));
  EXPECT_EQ(labelWords(b->labels(), 1), packLabels(second));
  b.reset();
  EXPECT_EQ(labelWords(a->labels(), 1), packLabels(first));
}

TEST(MetalWorldTest, EveryWorldHasALabelStreamEvenWithoutLabels) {
  auto& gpu = test::Gpu::get();
  // A bound buffer must hold at least 16 bytes even when no splat reads it.
  constexpr NSUInteger kMinimumBufferBytes = 16;
  auto empty = MetalWorld::upload(gpu.device, {}, 0);
  ASSERT_NE(empty, nullptr);
  ASSERT_NE(empty->labels(), nil);
  EXPECT_GE(empty->labels().length, kMinimumBufferBytes);
  auto unlabelled = MetalWorld::upload(gpu.device, cloud(), 0);
  ASSERT_NE(unlabelled, nullptr);
  EXPECT_GE(unlabelled->labels().length, kMinimumBufferBytes);
  EXPECT_EQ(labelWords(unlabelled->labels(), 1), std::vector<uint32_t>{0});
  auto mismatched = cloud();
  mismatched.labels = {1};
  EXPECT_EQ(MetalWorld::upload(gpu.device, mismatched, 0), nullptr);
}

TEST(MetalWorldTest, TileUpdatesWriteOrClearTheirLabelsAtTheirOffset) {
  auto& gpu = test::Gpu::get();
  auto world = MetalWorld::slab(gpu.device, 8, 0);
  ASSERT_NE(world, nullptr);
  ASSERT_GE(world->labels().length, 8u);
  auto labelled = cloud();
  labelled.labels = {5, 6};
  ASSERT_TRUE(world->uploadTile(1, labelled));
  // A tile without labels clears what an earlier tile left in its range.
  ASSERT_TRUE(world->uploadTile(5, labelled));
  ASSERT_TRUE(world->uploadTile(5, cloud()));
  const auto* bytes = static_cast<const uint8_t*>(world->labels().contents);
  const std::vector<uint8_t> written(bytes, bytes + 8);
  EXPECT_EQ(written, (std::vector<uint8_t>{0, 5, 6, 0, 0, 0, 0, 0}));
  labelled.labels = {1};
  EXPECT_FALSE(world->uploadTile(3, labelled));
}

}  // namespace
}  // namespace splatkit

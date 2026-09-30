#include <gtest/gtest.h>

#include <cstring>

#include "MetalTestContext.h"
#include "rendering/MetalWorld.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {
namespace {

splat::SplatCloud cloud() {
  splat::SplatCloud c;
  c.positions = {1, 2, -3, 4, 5, -6};
  c.covariances = {1, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 2};
  c.colors = {1, 0, 0, 0, 1, 0};
  c.alphas = {1, 0.5f};
  c.labels = {7, 0};
  return c;
}

TEST(MetalWorldTest, PrivateUploadMatchesTheSharedPacking) {
  auto& gpu = test::Gpu::get();
  const auto source = cloud();
  auto world = MetalWorld::upload(gpu.device, gpu.queue, source, 3);
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->info().count, 2u);
  EXPECT_EQ(world->info().shDegree, 0);
  EXPECT_EQ(world->splats().storageMode, MTLStorageModePrivate);
  const auto packed = packSplats(source);
  const size_t bytes = packed.size() * sizeof(GpuSplat);
  id<MTLBuffer> readback = [gpu.device newBufferWithLength:bytes
                                                   options:MTLResourceStorageModeShared];
  id<MTLCommandBuffer> cmd = [gpu.queue commandBuffer];
  id<MTLBlitCommandEncoder> copy = [cmd blitCommandEncoder];
  [copy copyFromBuffer:world->splats()
           sourceOffset:0
               toBuffer:readback
      destinationOffset:0
                   size:bytes];
  [copy endEncoding];
  [cmd commit];
  [cmd waitUntilCompleted];
  ASSERT_EQ(cmd.status, MTLCommandBufferStatusCompleted);
  EXPECT_EQ(std::memcmp(readback.contents, packed.data(), bytes), 0);
}

TEST(MetalWorldTest, UploadsAnEmptyWorldAndRefusesAMalformedOne) {
  auto& gpu = test::Gpu::get();
  auto world = MetalWorld::upload(gpu.device, gpu.queue, {}, 0);
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->info().count, 0u);
  auto malformed = cloud();
  malformed.alphas.clear();
  EXPECT_EQ(MetalWorld::upload(gpu.device, gpu.queue, malformed, 0), nullptr);
  malformed = cloud();
  malformed.labels.push_back(1);  // one label too many
  EXPECT_EQ(MetalWorld::upload(gpu.device, gpu.queue, malformed, 0), nullptr);
}

TEST(MetalWorldTest, ChunkedUploadPreservesSHAndRecordsAcrossStagingBoundary) {
  auto& gpu = test::Gpu::get();
  splat::SplatCloud source;
  source.shDegree = 1;
  for (uint32_t i = 0; i < 65539; ++i) {
    source.positions.insert(source.positions.end(), {static_cast<float>(i), 0, -2});
    source.covariances.insert(source.covariances.end(), {0.01f, 0, 0, 0.02f, 0, 0.03f});
    source.colors.insert(source.colors.end(), {1, 0, 0});
    source.alphas.push_back(i == 65536 ? 1.0f : 0.5f);
    for (int j = 0; j < 9; ++j) source.sh.push_back(static_cast<float>((i + j) % 17) / 32);
  }
  auto world = MetalWorld::upload(gpu.device, gpu.queue, source, 1);
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

}  // namespace
}  // namespace splatkit

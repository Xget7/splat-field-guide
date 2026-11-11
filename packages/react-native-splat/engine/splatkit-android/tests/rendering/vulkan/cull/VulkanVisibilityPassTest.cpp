#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <numeric>
#include <set>
#include <utility>
#include "../../../../../splatkit-engine/src/labels/LabelStyleUpload.h"

#include "rendering/vulkan/cull/VulkanVisibilityPass.h"
#include "rendering/vulkan/frame/VulkanCameraProjection.h"
#include "rendering/vulkan/layout/VulkanShStorage.h"
#include "splat/math/Half.h"
#include "splatkit/labels/LabelStyles.h"
#include "splatkit/rendering/GpuLayout.h"
#include "support/VulkanTestContext.h"

namespace {
using splatkit::CameraUniform;
using splatkit::GpuSplat;
using splatkit::KeyBits;
using splatkit::kFramesInFlight;
using splatkit::packSh;
using splatkit::packSplats;
using splatkit::ProjectedSplat;
using splatkit::VulkanBuffer;
using splatkit::VulkanVisibilityPass;
namespace test = splatkit::test;
using test::require;
using Mode = VulkanVisibilityPass::CandidateMode;

CameraUniform camera() {
  CameraUniform cam{};
  cam.view = splat::Mat4::identity();
  require(splatkit::setCameraProjection(cam, splat::Mat4::perspective(1, 1, 0.1f, 100), 1000, 1000),
          "valid camera projection");
  cam.focal[0] = cam.focal[1] = 500;
  cam.tanHalfFov[0] = cam.tanHalfFov[1] = 1;
  cam.screenSize[0] = cam.screenSize[1] = 1000;
  return cam;
}
std::vector<GpuSplat> source(uint32_t count) {
  splat::SplatCloud cloud;
  for (uint32_t i = 0; i < count; ++i) {
    cloud.positions.insert(cloud.positions.end(), {0, 0, -static_cast<float>(1 + i % 10)});
    cloud.covariances.insert(cloud.covariances.end(), {0.01f, 0, 0, 0.01f, 0, 0.01f});
    cloud.colors.insert(cloud.colors.end(), {1, 0, 0});
    cloud.alphas.push_back(0.5f);
  }
  return packSplats(cloud);
}
template <typename T>
std::unique_ptr<VulkanBuffer> upload(const test::VulkanTestContext& gpu,
                                     const std::vector<T>& values) {
  const size_t bytes = std::max(values.size() * sizeof(T), sizeof(T));
  auto buffer = VulkanBuffer::deviceLocal(*gpu.context, bytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  require(buffer != nullptr, "input allocation");
  const T zero{};
  require(buffer->upload(values.empty() ? &zero : values.data(), bytes), "input upload");
  return buffer;
}
struct Fixture {
  explicit Fixture(const test::VulkanTestContext& gpu)
      : splats(upload(gpu, source(300))),
        uniforms(VulkanBuffer::hostVisible(*gpu.context, sizeof(CameraUniform),
                                           VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT)) {
    require(uniforms != nullptr, "uniform allocation");
    setCamera(camera());
  }
  void setCamera(const CameraUniform& cam) const {
    std::memcpy(uniforms->mapped(), &cam, sizeof(cam));
    uniforms->flush(0, sizeof(cam));
  }
  VulkanVisibilityPass::Input input() const {
    VulkanVisibilityPass::Input in;
    in.camera = uniforms->handle();
    in.cameraBytes = uniforms->size();
    in.splats = splats->handle();
    in.splatsBytes = splats->size();
    in.sourceCount = 300;
    return in;
  }
  std::unique_ptr<VulkanBuffer> splats, uniforms;
};
struct Result {
  uint32_t count = 0, status = 0;
  VkDrawIndirectCommand draw{};
  std::vector<uint32_t> values, keys, sources;
  std::vector<ProjectedSplat> projected;
};
Result run(const test::VulkanTestContext& gpu, const VulkanVisibilityPass& pass,
           const VulkanVisibilityPass::Input& input, uint32_t slot = 0) {
  const VkDeviceSize words = pass.capacity() * 4ull;
  const VkDeviceSize records = pass.capacity() * sizeof(ProjectedSplat);
  const VkDeviceSize bytes = 24 + 2 * words + records;
  auto copy = VulkanBuffer::deviceLocal(
      *gpu.context, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT);
  require(copy != nullptr, "readback copy allocation");
  gpu.submit([&](VkCommandBuffer cmd) {
    require(pass.encode(cmd, slot, input), "visibility encode");
    auto out = pass.output(slot);
    const VkBufferCopy count{0, 0, 4};
    const VkBufferCopy status{0, 4, 4};
    const VkBufferCopy draw{0, 8, 16};
    const VkBufferCopy values{0, 24, words};
    const VkBufferCopy keys{0, 24 + words, words};
    const VkBufferCopy projected{0, 24 + 2 * words, records};
    vkCmdCopyBuffer(cmd, out.count, copy->handle(), 1, &count);
    vkCmdCopyBuffer(cmd, out.status, copy->handle(), 1, &status);
    vkCmdCopyBuffer(cmd, out.indirect, copy->handle(), 1, &draw);
    vkCmdCopyBuffer(cmd, out.values, copy->handle(), 1, &values);
    vkCmdCopyBuffer(cmd, out.depthKeys, copy->handle(), 1, &keys);
    vkCmdCopyBuffer(cmd, out.projected, copy->handle(), 1, &projected);
  });
  const auto raw = gpu.readback(*copy, bytes);
  Result result;
  std::memcpy(&result.count, raw.data(), 4);
  std::memcpy(&result.status, raw.data() + 4, 4);
  std::memcpy(&result.draw, raw.data() + 8, 16);
  require(result.count <= pass.capacity(), "count within output capacity");
  require(result.draw.vertexCount == 4 && result.draw.instanceCount == result.count &&
              result.draw.firstVertex == 0 && result.draw.firstInstance == 0,
          "indirect draw agrees with normalized count");
  result.values.resize(result.count);
  result.keys.resize(result.count);
  result.projected.resize(result.count);
  if (result.count) {
    std::memcpy(result.values.data(), raw.data() + 24, result.count * 4);
    std::memcpy(result.keys.data(), raw.data() + 24 + words, result.count * 4);
    std::memcpy(result.projected.data(), raw.data() + 24 + 2 * words,
                result.count * sizeof(ProjectedSplat));
  }
  for (uint32_t i = 0; i < result.count; ++i) {
    require(result.values[i] == i, "sort values are positions in the projected records");
    result.sources.push_back(result.projected[i].index);
  }
  return result;
}
void membership(const Result& result, std::vector<uint32_t> expected) {
  require(result.status == 0, "no visibility failure");
  auto indices = result.sources;
  std::sort(indices.begin(), indices.end());
  std::sort(expected.begin(), expected.end());
  require(indices == expected, "candidate membership equals expected source indices");
}
void failed(const Result& result, uint32_t bit) {
  require((result.status & bit) != 0 && result.count == 0 && result.draw.instanceCount == 0,
          "GPU failure zeros count and indirect draw");
}
void indexed(VulkanVisibilityPass::Input& in, const VulkanBuffer& indices,
             const VulkanBuffer& count, uint32_t bound) {
  in.mode = Mode::indices;
  in.candidates = indices.handle();
  in.candidatesBytes = indices.size();
  in.candidateCount = count.handle();
  in.candidateCountBytes = count.size();
  in.candidateCapacity = bound;
}
void ranges(VulkanVisibilityPass::Input& in, const VulkanBuffer& records, uint32_t count,
            uint32_t bound) {
  in.mode = Mode::ranges;
  in.candidates = records.handle();
  in.candidatesBytes = records.size();
  in.rangeCount = count;
  in.candidateCapacity = bound;
}

using Gpu = test::VulkanTestContext;

void testPrefix(const Gpu& gpu, const VulkanVisibilityPass& pass, const Fixture& f) {
  for (const uint32_t n : {0u, 1u, 127u, 128u, 129u, 257u, 300u}) {
    auto in = f.input();
    in.sourceCount = n;
    std::vector<uint32_t> expected(n);
    std::iota(expected.begin(), expected.end(), 0);
    membership(run(gpu, pass, in), expected);
    membership(run(gpu, pass, in, 1), expected);
  }
  std::puts("PASS prefix, empty, subgroup tails and descriptor slots");
}

void testSparseIndexed(const Gpu& gpu, const VulkanVisibilityPass& pass, const Fixture& f) {
  // LOD reserves far more entries than it emits. Poison inactive groups so reading
  // a capacity tail instead of the GPU count becomes a visible diagnostic failure.
  std::vector<uint32_t> sparseIndices(4097, UINT32_MAX);
  std::iota(sparseIndices.begin(), sparseIndices.begin() + 300, 0);
  auto sparseBuffer = upload(gpu, sparseIndices);
  auto sparseCount = upload(gpu, std::vector<uint32_t>{0});
  auto sparse = f.input();
  indexed(sparse, *sparseBuffer, *sparseCount, 4097);
  for (uint32_t n : {0u, 1u, 127u, 128u, 129u, 257u}) {
    require(sparseCount->upload(&n, 4), "sparse GPU count");
    std::vector<uint32_t> expected(n);
    std::iota(expected.begin(), expected.end(), 0);
    membership(run(gpu, pass, sparse), expected);
    membership(run(gpu, pass, sparse, 1), expected);
  }
  uint32_t sparseInvalid = 4098;
  require(sparseCount->upload(&sparseInvalid, 4), "sparse invalid count");
  failed(run(gpu, pass, sparse), VulkanVisibilityPass::kInvalidCount);
  sparseInvalid = 0;
  require(sparseCount->upload(&sparseInvalid, 4), "sparse empty count");
  sparse.keyBits = KeyBits::low16;
  membership(run(gpu, pass, sparse), {});
  std::puts("PASS sparse indexed workgroups, poisoned tails and empty diagnostics");
}

void testIndexedLod(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  require(pass.reserve(3), "small output capacity");
  auto indexBuffer = upload(gpu, std::vector<uint32_t>{299, 0, 128});
  auto countBuffer = upload(gpu, std::vector<uint32_t>{3});
  auto in = f.input();
  indexed(in, *indexBuffer, *countBuffer, 3);
  membership(run(gpu, pass, in), {299, 0, 128});
  const uint32_t zero = 0;
  const uint32_t excessive = 4;
  require(countBuffer->upload(&zero, 4), "zero GPU count");
  membership(run(gpu, pass, in), {});
  in.candidateCapacity = 0;
  membership(run(gpu, pass, in), {});
  require(countBuffer->upload(&excessive, 4), "bad GPU count");
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidCount);
  in.candidateCapacity = 3;
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidCount);
  auto badIndex = upload(gpu, std::vector<uint32_t>{0, 300, UINT32_MAX});
  const uint32_t three = 3;
  require(countBuffer->upload(&three, 4), "restore GPU count");
  indexed(in, *badIndex, *countBuffer, 3);
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidIndex);
  std::puts("PASS indexed LOD, high resident indices, bad index/count");
}

void testRanges(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  using Range = VulkanVisibilityPass::Range;
  require(pass.reserve(5), "range output capacity");
  auto records = upload(gpu, std::vector<Range>{{2, 2, 2, 0}, {290, 3, 5, 0}});
  auto in = f.input();
  ranges(in, *records, 2, 5);
  membership(run(gpu, pass, in), {2, 3, 290, 291, 292});
  auto emptyRecords = upload(gpu, std::vector<Range>{});
  ranges(in, *emptyRecords, 0, 0);
  membership(run(gpu, pass, in), {});
  auto badRecords = upload(gpu, std::vector<Range>{{299, 2, 2, 0}});
  ranges(in, *badRecords, 1, 2);
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidRange);
  auto badPrefix = upload(gpu, std::vector<Range>{{2, 2, 3, 0}});
  ranges(in, *badPrefix, 1, 2);
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidRange);
  auto overlap = upload(gpu, std::vector<Range>{{2, 2, 2, 0}, {3, 2, 4, 0}});
  ranges(in, *overlap, 2, 4);
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidRange);
  auto hiddenBadRange = upload(gpu, std::vector<Range>{{0, 2, 2, 0}, {2, 1, 1, 0}, {4, 2, 3, 0}});
  ranges(in, *hiddenBadRange, 3, 3);
  failed(run(gpu, pass, in), VulkanVisibilityPass::kInvalidRange);
  std::puts("PASS streamed ranges, empty ranges and malformed ranges");
}

void testOverflow(const Gpu& gpu, const VulkanVisibilityPass& pass, const Fixture& f) {
  auto in = f.input();  // source count exceeds output capacity: GPU overflow, never CPU truncation
  failed(run(gpu, pass, in), VulkanVisibilityPass::kOverflow);
  in.candidateCapacity = 3;
  membership(run(gpu, pass, in), {0, 1, 2});
  std::puts("PASS output overflow fails closed and recovers");
}

uint32_t expectedDepthKey(float depth, KeyBits bits, VulkanVisibilityPass::KeyOrder order) {
  const auto cam = camera();
  const float nearPlane = cam.proj.at(2, 3) / cam.proj.at(2, 2);
  const bool low16 = bits == KeyBits::low16;
  uint32_t expected = 0;
  std::memcpy(&expected, &depth, 4);
  if (low16) {
    uint32_t nearBits = 0;
    std::memcpy(&nearBits, &nearPlane, 4);
    expected = std::min((expected - nearBits) >> 11, 65535u);
  }
  if (order == VulkanVisibilityPass::KeyOrder::descending)
    expected = low16 ? 65535 - expected : ~expected;
  return expected;
}

void requireDepthKeys(const Result& result, KeyBits bits, VulkanVisibilityPass::KeyOrder order) {
  for (size_t i = 0; i < result.count; ++i) {
    const auto depth = static_cast<float>(1 + result.sources[i] % 10);
    const uint32_t expected = expectedDepthKey(depth, bits, order);
    if (bits == KeyBits::full32)
      require(result.keys[i] == expected,
              "32-bit depth key preserves float bits and BTF inversion");
    else
      require(
          result.keys[i] <= 65535 && std::abs(static_cast<int64_t>(result.keys[i]) - expected) <= 1,
          "16-bit quantized depth key (one-bin floating-point tolerance)");
  }
}

void testDepthKeys(const Gpu& gpu, const VulkanVisibilityPass& pass, const Fixture& f) {
  auto in = f.input();
  in.candidateCapacity = 3;
  for (auto bits : {KeyBits::full32, KeyBits::low16}) {
    for (auto order :
         {VulkanVisibilityPass::KeyOrder::ascending, VulkanVisibilityPass::KeyOrder::descending}) {
      in.keyBits = bits;
      in.keyOrder = order;
      auto result = run(gpu, pass, in);
      membership(result, {0, 1, 2});
      requireDepthKeys(result, bits, order);
    }
  }
  std::puts("PASS full32/low16 ascending/BTF keys");
}

void testDescriptorRejection(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  const auto old = pass.output(0);
  require(!pass.reserve(0) && !pass.reserve(VulkanVisibilityPass::kMaxCapacity + 1),
          "reject capacity bounds");
  require(pass.output(0).values == old.values && pass.output(0).projected == old.projected,
          "reserve failure preserves output");
  auto indexBuffer = upload(gpu, std::vector<uint32_t>{299, 0, 128});
  auto countBuffer = upload(gpu, std::vector<uint32_t>{3});
  auto in = f.input();
  in.candidateCapacity = 3;
  gpu.submit([&](VkCommandBuffer cmd) {
    auto bad = in;
    bad.splatsBytes = 32;
    require(!pass.encode(cmd, 0, bad), "reject undersized resident source descriptor");
    bad = in;
    bad.cameraBytes = sizeof(CameraUniform) - 1;
    require(!pass.encode(cmd, 0, bad), "reject undersized uniform descriptor");
    bad = in;
    bad.splatsOffset = std::numeric_limits<VkDeviceSize>::max();
    require(!pass.encode(cmd, 0, bad), "reject offset overflow or misalignment");
    bad = in;
    // Fixed uint32_t underlying type permits this value; exercise enum validation.
    // NOLINTNEXTLINE(clang-analyzer-optin.core.EnumCastOutOfRange)
    bad.mode = static_cast<Mode>(99);
    require(!pass.encode(cmd, 0, bad), "reject unknown mode");
    bad = in;
    indexed(bad, *indexBuffer, *countBuffer, 3);
    bad.candidatesBytes = 4;
    require(!pass.encode(cmd, 0, bad), "reject undersized candidate descriptor");
    bad.candidatesBytes = indexBuffer->size();
    bad.candidateCountBytes = 3;
    require(!pass.encode(cmd, 0, bad), "reject undersized count descriptor");
    require(!pass.encode(cmd, kFramesInFlight, in), "reject invalid slot");
    require(!pass.encode(VK_NULL_HANDLE, 0, in), "reject null command");
  });
  membership(run(gpu, pass, in), {0, 1, 2});
  std::puts("PASS descriptor rejection and transactional capacity");
}

// The quad ends where the Gaussian falls to the cutoff, out to 2.5 sigma and 512 pixels:
// a splat under the cutoff has no quad, and a quad that misses the screen is culled.
void testQuadExtent(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  splat::SplatCloud cloud;
  const auto add = [&](float x, float z, float variance, float alpha) {
    cloud.positions.insert(cloud.positions.end(), {x, 0, z});
    cloud.covariances.insert(cloud.covariances.end(), {variance, 0, 0, variance, 0, variance});
    cloud.colors.insert(cloud.colors.end(), {1, 1, 1});
    cloud.alphas.push_back(alpha);
  };
  // x at depth 10 whose centre projects to `ndc`.
  const auto atNdc = [](float ndc) { return ndc * 10.0f / camera().proj.at(0, 0); };
  add(0, -5, 0.01f, 1.0f / 255.0f);
  add(0, -5, 0.01f, 3.0f / 255.0f);
  // 100 px sigma, about 138 px across x this far out, centred 375 px past the right edge:
  // a 3 sigma quad reaches the screen, a 2.5 sigma one stops short.
  add(atNdc(1.75f), -10, 4, 0.5f);
  // 2000 px sigma centred 2500 px past the edge: the 512 px cap stops the quad short.
  add(atNdc(6), -10, 1600, 0.5f);
  add(0, -10, 1600, 0.5f);
  auto splats = upload(gpu, packSplats(cloud));
  require(pass.reserve(5), "quad extent output capacity");
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = 5;
  membership(run(gpu, pass, in), {1, 4});
  std::puts("PASS quad cutoff, 2.5 sigma extent and 512 px cap");
}

// MetalVisibilityPassTest.KeepsOnlySplatsAtOrOverTheCameraCutoff is the same case.
void testCameraCutoff(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  // An opaque splat at depth 20 with focal 500: source sigma 0.3 px, a 2.5 sigma quad, so a
  // 0.75 px footprint.
  splat::SplatCloud cloud;
  cloud.positions = {0, 0, -20};
  cloud.covariances = {1.44e-4f, 0, 0, 1.44e-4f, 0, 1.44e-4f};
  cloud.colors = {1, 1, 1};
  cloud.alphas = {1};
  auto splats = upload(gpu, packSplats(cloud));
  require(pass.reserve(1), "cutoff output capacity");
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = 1;
  for (const auto [cutoff, kept] : {std::pair{0.5f, 1u}, std::pair{1.0f, 0u}}) {
    CameraUniform cam = camera();
    cam.minPixelRadius = cutoff;
    f.setCamera(cam);
    require(run(gpu, pass, in).count == kept,
            cutoff < 1 ? "0.75 px kept at a 0.5 px cutoff" : "0.75 px dropped at a 1 px cutoff");
  }
  f.setCamera(camera());
  std::puts("PASS the camera's cutoff keeps a 0.75 px footprint at 0.5 px and drops it at 1 px");
}

std::pair<float, float> halves(uint32_t packed) {
  return {splat::fromHalf(static_cast<uint16_t>(packed & 0xffffu)),
          splat::fromHalf(static_cast<uint16_t>(packed >> 16))};
}
void requireNear(float got, float expected, float tolerance, const char* what) {
  if (!std::isfinite(got) || std::abs(got - expected) > tolerance) {
    std::fprintf(stderr, "%s: got %f, expected %f\n", what, got, expected);
    require(false, what);
  }
}

// The cull writes the quad the draw expands: centre, half axes, colour seen from the camera,
// peak opacity, radius and source index, with SH evaluated when the world carries it.
void testProjectedRecord(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  constexpr float kX = 0.5f;
  constexpr float kZ = -5;
  constexpr float kVariance = 0.01f;
  constexpr float kAlpha = 0.5f;
  constexpr float kRgb[3] = {0.2f, 0.4f, 0.6f};
  constexpr float kBand1Z[3] = {0.1f, -0.2f, 0.3f};  // the coefficient the z direction weights
  splat::SplatCloud cloud;
  for (const float alpha : {1.0f / 255.0f, kAlpha}) {  // the first has no quad
    cloud.positions.insert(cloud.positions.end(), {kX, 0, kZ});
    cloud.covariances.insert(cloud.covariances.end(), {kVariance, 0, 0, kVariance, 0, kVariance});
    cloud.colors.insert(cloud.colors.end(), std::begin(kRgb), std::end(kRgb));
    cloud.alphas.push_back(alpha);
    cloud.sh.insert(cloud.sh.end(), {0, 0, 0, kBand1Z[0], kBand1Z[1], kBand1Z[2], 0, 0, 0});
  }
  cloud.shDegree = 1;
  auto splats = upload(gpu, packSplats(cloud));
  auto sh = upload(gpu, packSh(cloud, 1, splatkit::kVulkanShStorage));
  require(pass.reserve(2), "projected record capacity");
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = 2;
  in.sh = sh->handle();
  in.shBytes = sh->size();

  const auto cam = camera();
  const float focal = cam.focal[0];
  // J Sigma J^T of an isotropic splat at (x, 0, z), plus the low-pass filter.
  const float varianceX =
      kVariance * focal * focal * (1 / (kZ * kZ) + kX * kX / (kZ * kZ * kZ * kZ));
  const float varianceY = kVariance * focal * focal / (kZ * kZ);
  const float quantized = [](float v) { return std::lround(v * 255) / 255.0f; }(kAlpha);
  const float direction = kZ / std::sqrt(kX * kX + kZ * kZ);
  constexpr float kC1 = 0.4886025119f;
  for (const int degree : {0, 1}) {
    in.shDegree = degree;
    const auto result = run(gpu, pass, in);
    membership(result, {1});
    const auto& p = result.projected[0];
    requireNear(p.center[0], cam.proj.at(0, 0) * kX / -kZ, 1e-5f, "centre x");
    requireNear(p.center[1], 0, 1e-5f, "centre y");
    const auto [a1x, a1y] = halves(p.axis1);
    const auto [a2x, a2y] = halves(p.axis2);
    requireNear(a1x, std::sqrt(varianceX + 0.3f), 1e-2f, "major axis");
    requireNear(a1y, 0, 1e-3f, "major axis direction");
    requireNear(a2x, 0, 1e-3f, "minor axis direction");
    requireNear(std::abs(a2y), std::sqrt(varianceY + 0.3f), 1e-2f, "minor axis");
    requireNear(p.radius, 2.5f, 1e-5f, "radius stops at 2.5 sigma");
    const auto [red, green] = halves(p.color0);
    const auto [blue, opacity] = halves(p.color1);
    const float rgb[3] = {red, green, blue};
    for (int c = 0; c < 3; ++c) {
      const float base = std::lround(kRgb[c] * 255) / 255.0f;
      const float shifted =
          degree == 0 ? base : std::max(base + kC1 * direction * kBand1Z[c], 0.0f);
      requireNear(rgb[c], shifted, 2e-3f, degree == 0 ? "base colour" : "colour with band 1");
    }
    requireNear(opacity, quantized, 1e-3f, "peak opacity");
  }
  std::puts("PASS projected record: centre, half axes, colour with SH, opacity, radius, source");
}

// The degree-3 z term reads a late SH word and the second record's independent scale.
void testDegree3Color(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  splat::SplatCloud cloud;
  cloud.shDegree = 3;
  for (const float coefficient : {0.05f, 0.3f}) {
    cloud.positions.insert(cloud.positions.end(), {0, 0, -5});
    cloud.covariances.insert(cloud.covariances.end(), {0.01f, 0, 0, 0.01f, 0, 0.01f});
    cloud.colors.insert(cloud.colors.end(), {0.5f, 0.5f, 0.5f});
    cloud.alphas.push_back(0.5f);
    const size_t offset = cloud.sh.size();
    cloud.sh.resize(offset + 45, 0);
    cloud.sh[offset + 11 * 3] = coefficient;
    cloud.sh[offset + 11 * 3 + 1] = -coefficient;
    cloud.sh[offset + 11 * 3 + 2] = coefficient * 0.5f;
  }
  auto splats = upload(gpu, packSplats(cloud));
  auto sh = upload(gpu, packSh(cloud, 3, splatkit::kVulkanShStorage));
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = 2;
  in.shDegree = 3;
  in.sh = sh->handle();
  in.shBytes = sh->size();
  require(pass.reserve(2), "degree 3 capacity");
  const auto result = run(gpu, pass, in);
  membership(result, {0, 1});
  const float base = 128.0f / 255.0f;
  // At direction (0, 0, -1), Y_3,0 = 0.3731763326 * z * 2*z*z.
  constexpr float kZTerm = -2.0f * 0.3731763326f;
  for (const auto& p : result.projected) {
    const float coefficient = p.index == 0 ? 0.05f : 0.3f;
    const auto [red, green] = halves(p.color0);
    const auto [blue, opacity] = halves(p.color1);
    requireNear(red, base + kZTerm * coefficient, 2e-3f, "degree 3 red");
    requireNear(green, base - kZTerm * coefficient, 2e-3f, "degree 3 green");
    requireNear(blue, base + kZTerm * coefficient * 0.5f, 2e-3f, "degree 3 blue");
    requireNear(opacity, base, 1e-3f, "degree 3 opacity");
  }
  std::puts("PASS degree 3 projected colour and per-record SH stride");
}

std::unique_ptr<VulkanVisibilityPass> labelledPass(const Gpu& gpu, uint32_t capacity) {
  const auto pipelines = VulkanVisibilityPass::Pipelines::compile(*gpu.context, true);
  require(pipelines && pipelines->partLabels, "compile labelled pipeline family");
  auto created = VulkanVisibilityPass::create(*gpu.context, pipelines);
  require(static_cast<bool>(created), "create labelled pass");
  auto pass = std::move(created.value());
  require(pass->reserve(capacity), "reserve labelled output");
  return pass;
}
// The palette and state table as the world uploads them for a frame.
std::unique_ptr<VulkanBuffer> styleTable(const Gpu& gpu, const splatkit::LabelStyles& styles) {
  std::vector<uint32_t> bytes(splatkit::labelStyleBytes(styles.states().size()) / sizeof(uint32_t));
  splatkit::LabelStyleUpload revision;
  require(revision.copy(bytes.data(), styles.states().size(), &styles), "copy state revision");
  return upload(gpu, bytes);
}
void withLabels(VulkanVisibilityPass::Input& in, const VulkanBuffer& labels,
                const VulkanBuffer& styles) {
  in.labels = labels.handle();
  in.labelsBytes = labels.size();
  in.styles = styles.handle();
  in.stylesBytes = styles.size();
}

void testLabels(const Gpu& gpu, const Fixture& f) {
  const auto pass = labelledPass(gpu, 300);
  const auto labels = upload(gpu, std::vector<uint32_t>(150, 0xffffffffu));
  splatkit::LabelStyles styles(65536);
  auto states = styles.states();
  states[65535] = 1;
  styles.setStates(states);
  auto palette = styles.palette();
  palette[1].tint[1] = 1;
  palette[1].tintAmount = 1;
  styles.setPalette(palette);
  const auto table = styleTable(gpu, styles);
  auto in = f.input();
  withLabels(in, *labels, *table);
  const auto result = run(gpu, *pass, in);
  require(result.count == 300 && result.status == 0, "labelled survivors");
  for (const auto& p : result.projected) {
    require(p.color0 == (uint32_t{splat::toHalf(1)} << 16), "full-width label style lookup");
  }
}

// Shared by the style and reveal cases: records at depth 5 seen head on.
constexpr float kStyledZ = -5;
constexpr float kStyledVariance = 0.01f;
constexpr float kStyledAlpha = 0.5f;
constexpr float kStyledRgb[3] = {0.2f, 0.4f, 0.6f};
// Half-precision colour after the shader's colour maths, gamma round trips included.
constexpr float kStyledTolerance = 3e-3f;
constexpr float kDisplayGamma = 2.2f;           // splat_projection.glsl
constexpr float kQuadMinAlpha = 2.0f / 255.0f;  // splat_footprint.glsl

float unorm8(float v) {
  return std::lround(v * 255) / 255.0f;
}
splat::SplatCloud styledCloud(const std::vector<float>& heights) {
  splat::SplatCloud cloud;
  for (const float y : heights) {
    cloud.positions.insert(cloud.positions.end(), {0, y, kStyledZ});
    cloud.covariances.insert(cloud.covariances.end(),
                             {kStyledVariance, 0, 0, kStyledVariance, 0, kStyledVariance});
    cloud.colors.insert(cloud.colors.end(), std::begin(kStyledRgb), std::end(kStyledRgb));
    cloud.alphas.push_back(kStyledAlpha);
  }
  return cloud;
}
struct Rgba {
  float rgb[3];
  float alpha;
};
Rgba unstyled() {
  return {{unorm8(kStyledRgb[0]), unorm8(kStyledRgb[1]), unorm8(kStyledRgb[2])},
          unorm8(kStyledAlpha)};
}
// visibility_body.glsl: the colour is mixed toward the tint and scaled in the encoded space.
Rgba styled(Rgba c, const splatkit::LabelStyle& style) {
  for (int i = 0; i < 3; ++i)
    c.rgb[i] = (c.rgb[i] + (style.tint[i] - c.rgb[i]) * style.tintAmount) * style.brightness;
  c.alpha *= style.opacity;
  return c;
}
// splat_projection.glsl revealGlow: the glow eases in over the band below the level.
Rgba glowing(Rgba c, const splatkit::RevealUniform& reveal, float height) {
  const float ramp = std::clamp(1 - (reveal.level - height) / reveal.band, 0.0f, 1.0f);
  const float glow = ramp * ramp;
  for (int i = 0; i < 3; ++i)
    c.rgb[i] = (c.rgb[i] + (reveal.tint[i] - c.rgb[i]) * reveal.tintAmount * glow) *
               (1 + reveal.brightnessBoost * glow);
  return c;
}
void requireColour(const ProjectedSplat& p, const Rgba& expected, bool linear, const char* what) {
  const auto [red, green] = halves(p.color0);
  const auto [blue, opacity] = halves(p.color1);
  const float got[3] = {red, green, blue};
  for (int c = 0; c < 3; ++c) {
    const float want = linear ? std::pow(expected.rgb[c], kDisplayGamma) : expected.rgb[c];
    requireNear(got[c], want, kStyledTolerance, what);
  }
  requireNear(opacity, expected.alpha, kStyledTolerance, what);
}
bool sameRecord(const ProjectedSplat& a, const ProjectedSplat& b) {
  return a.center[0] == b.center[0] && a.center[1] == b.center[1] && a.axis1 == b.axis1 &&
         a.axis2 == b.axis2 && a.color0 == b.color0 && a.color1 == b.color1 &&
         a.radius == b.radius && a.index == b.index;
}
const ProjectedSplat& record(const Result& result, uint32_t source) {
  for (const auto& p : result.projected)
    if (p.index == source) return p;
  throw std::runtime_error("source record missing");
}

// Each record's label picks its state from its own half of the packed word, and the state's
// tint, brightness and opacity apply; opacity under the quad cutoff hides the record.
void testLabelStyles(const Gpu& gpu, const Fixture& f) {
  enum State : uint32_t { kPlain, kTinted, kPartial, kHidden, kFaintCulled, kFaintKept };
  constexpr uint16_t kTintedLabel = 1;
  constexpr uint16_t kPartialLabel = 300;
  constexpr uint16_t kHiddenLabel = 40000;
  constexpr uint16_t kFaintCulledLabel = 7;
  constexpr uint16_t kFaintKeptLabel = 8;
  // Neighbours in a word differ, and words 0 and 3 swap the same pair of labels.
  const std::vector<uint16_t> labels{
      kTintedLabel,      kPartialLabel,   kHiddenLabel,  0,
      kFaintCulledLabel, kFaintKeptLabel, kPartialLabel, kTintedLabel};
  const std::vector<State> expected{kTinted,      kPartial,   kHidden,  kPlain,
                                    kFaintCulled, kFaintKept, kPartial, kTinted};
  auto cloud = styledCloud(std::vector<float>(labels.size(), 0));
  cloud.labels = labels;
  auto splats = upload(gpu, packSplats(cloud));
  auto words = upload(gpu, splatkit::packLabels(cloud));

  splatkit::LabelStyles styles(kHiddenLabel + 1);
  auto states = styles.states();
  states[kTintedLabel] = kTinted;
  states[kPartialLabel] = kPartial;
  states[kHiddenLabel] = kHidden;
  states[kFaintCulledLabel] = kFaintCulled;
  states[kFaintKeptLabel] = kFaintKept;
  styles.setStates(states);
  auto palette = styles.palette();
  palette[kTinted].tint[1] = 1;
  palette[kTinted].tintAmount = 1;
  palette[kPartial].tint[0] = 1;
  palette[kPartial].tintAmount = 0.25f;
  palette[kPartial].brightness = 0.5f;
  palette[kPartial].opacity = 0.6f;
  palette[kHidden].opacity = 0;
  // Peak alpha 128/255 times these lands either side of the 2/255 quad cutoff.
  palette[kFaintCulled].opacity = 0.01f;
  palette[kFaintKept].opacity = 0.02f;
  styles.setPalette(palette);
  require(unorm8(kStyledAlpha) * palette[kFaintCulled].opacity < kQuadMinAlpha &&
              unorm8(kStyledAlpha) * palette[kFaintKept].opacity > kQuadMinAlpha,
          "faint opacities straddle the quad cutoff");
  const auto table = styleTable(gpu, styles);

  const auto pass = labelledPass(gpu, static_cast<uint32_t>(labels.size()));
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = static_cast<uint32_t>(labels.size());
  withLabels(in, *words, *table);
  for (const bool linear : {false, true}) {
    CameraUniform cam = camera();
    cam.outputLinear = linear ? 1 : 0;
    f.setCamera(cam);
    const auto result = run(gpu, *pass, in);
    membership(result, {0, 1, 3, 5, 6, 7});
    for (const auto& p : result.projected)
      requireColour(p, styled(unstyled(), palette[expected[p.index]]), linear,
                    linear ? "linear-output label style" : "label style");
  }
  f.setCamera(camera());
  std::puts("PASS label halves pick their own state; tint, brightness, opacity and hiding apply");
}

constexpr float kRevealLevel = 0.1f;
constexpr float kRevealBand = 0.4f;
splatkit::RevealUniform midSweep() {
  splatkit::RevealUniform reveal;
  reveal.level = kRevealLevel;
  reveal.band = kRevealBand;
  reveal.tintAmount = 0.8f;
  reveal.brightnessBoost = 0.5f;
  reveal.tint[0] = 0;
  reveal.tint[1] = 1;
  reveal.tint[2] = 0;
  return reveal;
}
Result runReveal(const Gpu& gpu, const VulkanVisibilityPass& pass, const Fixture& f,
                 const VulkanVisibilityPass::Input& in, const splatkit::RevealUniform& reveal) {
  CameraUniform cam = camera();
  cam.reveal = reveal;
  f.setCamera(cam);
  auto result = run(gpu, pass, in);
  f.setCamera(camera());
  return result;
}

// Mid-sweep, records above the level are culled, the band below it glows toward the tint and
// records under the band are untouched. Idle leaves every record as it was.
void testReveal(const Gpu& gpu, VulkanVisibilityPass& pass, const Fixture& f) {
  // Above the level, at it, two in the band, one under the band, and a NaN height.
  const std::vector<float> heights{
      0.4f, 0.2f, kRevealLevel, 0.0f, -0.2f, -0.4f, std::numeric_limits<float>::quiet_NaN()};
  constexpr uint32_t kUnderBand = 5;
  auto splats = upload(gpu, packSplats(styledCloud(heights)));
  require(pass.reserve(static_cast<uint32_t>(heights.size())), "reveal output capacity");
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = static_cast<uint32_t>(heights.size());

  const auto idle = runReveal(gpu, pass, f, in, {});
  membership(idle, {0, 1, 2, 3, 4, 5});
  for (const auto& p : idle.projected) requireColour(p, unstyled(), false, "idle colour");
  const auto reveal = midSweep();
  const auto sweep = runReveal(gpu, pass, f, in, reveal);
  membership(sweep, {2, 3, 4, 5});
  for (const auto& p : sweep.projected) {
    if (p.index == kUnderBand) {
      require(sameRecord(p, record(idle, p.index)), "a record under the band is untouched");
    } else {
      requireColour(p, glowing(unstyled(), reveal, heights[p.index]), false, "reveal glow");
    }
  }
  const auto restored = runReveal(gpu, pass, f, in, {});
  membership(restored, {0, 1, 2, 3, 4, 5});
  for (const auto& p : restored.projected)
    require(sameRecord(p, record(idle, p.index)),
            "an idle reveal after a sweep restores every record");
  std::puts("PASS reveal culls above the level, glows in the band and idles to the same records");
}

// The reveal applies after the label style: a hidden part stays hidden in the band, and a
// styled part glows from its styled colour.
void testRevealWithLabels(const Gpu& gpu, const Fixture& f) {
  enum State : uint32_t { kPlain, kHidden, kPartial };
  constexpr uint16_t kHiddenLabel = 2;
  constexpr uint16_t kPartialLabel = 3;
  const std::vector<float> heights{0.4f, 0.0f, 0.0f, -0.4f, -0.4f, 0.0f};
  const std::vector<uint16_t> labels{kPartialLabel, kHiddenLabel,  kPartialLabel,
                                     kHiddenLabel,  kPartialLabel, 0};
  auto cloud = styledCloud(heights);
  cloud.labels = labels;
  auto splats = upload(gpu, packSplats(cloud));
  auto words = upload(gpu, splatkit::packLabels(cloud));
  splatkit::LabelStyles styles(kPartialLabel + 1);
  auto states = styles.states();
  states[kHiddenLabel] = kHidden;
  states[kPartialLabel] = kPartial;
  styles.setStates(states);
  auto palette = styles.palette();
  palette[kHidden].opacity = 0;
  palette[kPartial].tint[2] = 1;
  palette[kPartial].tintAmount = 0.5f;
  palette[kPartial].brightness = 0.8f;
  palette[kPartial].opacity = 0.7f;
  styles.setPalette(palette);
  const auto table = styleTable(gpu, styles);
  const auto pass = labelledPass(gpu, static_cast<uint32_t>(heights.size()));
  auto in = f.input();
  in.splats = splats->handle();
  in.splatsBytes = splats->size();
  in.sourceCount = static_cast<uint32_t>(heights.size());
  withLabels(in, *words, *table);
  const auto reveal = midSweep();
  const auto result = runReveal(gpu, *pass, f, in, reveal);
  membership(result, {2, 4, 5});
  for (const auto& p : result.projected) {
    const auto style = palette[labels[p.index] == kPartialLabel ? kPartial : kPlain];
    requireColour(p, glowing(styled(unstyled(), style), reveal, heights[p.index]), false,
                  "reveal glow over a label style");
  }
  std::puts("PASS reveal composes with hidden and styled label states");
}

void tests(const Gpu& gpu) {
  auto created = VulkanVisibilityPass::create(*gpu.context);
  require(static_cast<bool>(created), "create subgroup visibility pass");
  auto pass = std::move(created.value());
  const Fixture f(gpu);
  require(pass->reserve(300), "reserve output");
  require(!pass->pipelines()->partLabels, "default pipeline family remains unlabelled");
  testLabels(gpu, f);
  testLabelStyles(gpu, f);
  testRevealWithLabels(gpu, f);
  testPrefix(gpu, *pass, f);
  testSparseIndexed(gpu, *pass, f);
  testIndexedLod(gpu, *pass, f);
  testRanges(gpu, *pass, f);
  testOverflow(gpu, *pass, f);
  testDepthKeys(gpu, *pass, f);
  testDescriptorRejection(gpu, *pass, f);
  testQuadExtent(gpu, *pass, f);
  testCameraCutoff(gpu, *pass, f);
  testProjectedRecord(gpu, *pass, f);
  testDegree3Color(gpu, *pass, f);
  testReveal(gpu, *pass, f);
}
}  // namespace

int main() {
  try {
    test::VulkanTestContext gpu;
    std::printf("GPU: %s\n", gpu.context->deviceDescription().c_str());
    tests(gpu);
    gpu.requireValidationClean();
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL: %s\n", error.what());
    return 1;
  }
}

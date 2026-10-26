#include <algorithm>
#include <cstdio>
#include <cstring>
#include <limits>
#include <numeric>
#include <string>

#include "rendering/vulkan/frame/VulkanFrameCompute.h"
#include "rendering/vulkan/layout/VulkanShaderTypes.h"
#include "splatkit/guide/GuideLayout.h"
#include "splatkit/rendering/GpuLayout.h"
#include "splatkit/rendering/RenderPolicy.h"
#include "support/VulkanTestContext.h"

namespace {
using splatkit::CameraUniform;
using splatkit::GpuSplat;
using splatkit::LabelStyles;
using splatkit::packSplats;
using splatkit::ProjectedSplat;
using splatkit::RenderPolicy;
using splatkit::SortKeyBits;
using splatkit::SplatRenderer;
using splatkit::VulkanBuffer;
using splatkit::VulkanFrameCompute;
namespace test = splatkit::test;
using test::require;

constexpr uint32_t kPolicyLeaves = 64;
// Thresholds far past any node's error either way, so the cut does not hang on the fixture.
constexpr float kCoarsestPixels = 1e6f;
constexpr float kFinestPixels = 1e-4f;
// No reveal running: everything is drawn.
constexpr float kNoReveal = std::numeric_limits<float>::infinity();
// Field Guide's label stream needs at least 16 bytes even for a world of few splats.
constexpr size_t kMinLabelWords = 4;

splat::SplatCloud cloud(uint32_t count) {
  splat::SplatCloud result;
  for (uint32_t i = 0; i < count; ++i) {
    result.positions.insert(result.positions.end(), {0, 0, -1.0f - i * 0.02f});
    result.covariances.insert(result.covariances.end(), {0.01f, 0, 0, 0.01f, 0, 0.01f});
    result.colors.insert(result.colors.end(), {1, 0, 0});
    result.alphas.push_back(0.5f);
  }
  return result;
}

struct Inputs {
  Inputs(const test::VulkanTestContext& gpu, const splat::SplatCloud& source) {
    camera = VulkanBuffer::hostVisible(*gpu.context, sizeof(CameraUniform),
                                       VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
    auto packed = packSplats(source);
    if (packed.empty()) packed.resize(1);
    splats = VulkanBuffer::deviceLocal(*gpu.context, packed.size() * sizeof(GpuSplat),
                                       VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
    // Degree 0 worlds never read the harmonics; the binding still needs a buffer.
    sh = VulkanBuffer::deviceLocal(*gpu.context, sizeof(uint32_t),
                                   VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
    // Every splat takes label 0, one byte each, four to a word.
    const std::vector<uint32_t> words(std::max(kMinLabelWords, (source.count() + 3) / 4), 0);
    labels = VulkanBuffer::deviceLocal(*gpu.context, words.size() * sizeof(uint32_t),
                                       VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
    require(camera && splats && sh && labels &&
                splats->upload(packed.data(), packed.size() * sizeof(GpuSplat)) &&
                labels->upload(words.data(), words.size() * sizeof(uint32_t)),
            "frame input allocation/upload");
    setView(0);
  }
  void setView(float x) const {
    CameraUniform u{};
    u.view = splat::Mat4::identity();
    u.view.at(0, 3) = x;
    u.proj = splat::Mat4::perspective(1, 1, 0.1f, 100);
    u.screenSize[0] = u.screenSize[1] = 1000;
    u.focal[0] = u.focal[1] = 500;
    u.tanHalfFov[0] = u.tanHalfFov[1] = 1;
    std::memcpy(camera->mapped(), &u, sizeof(u));
    camera->flush(0, sizeof(u));
  }
  std::unique_ptr<VulkanBuffer> camera, splats, sh, labels;
};

std::vector<uint32_t> run(const test::VulkanTestContext& gpu, VulkanFrameCompute& pass,
                          const Inputs& inputs, uint32_t slot, uint32_t capacity,
                          const std::vector<SplatRenderer::Range>& ranges,
                          float revealLevel = kNoReveal, const LabelStyles* styles = nullptr) {
  const VkDeviceSize orderBytes = std::max(1u, capacity) * 4ull;
  const VkDeviceSize bytes =
      sizeof(VkDrawIndirectCommand) + orderBytes + std::max(1u, capacity) * sizeof(ProjectedSplat);
  auto copy = VulkanBuffer::deviceLocal(*gpu.context, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
  require(copy != nullptr, "frame result allocation");
  gpu.submit([&](VkCommandBuffer cmd) {
    SplatRenderer::Frame frame;
    frame.orderSource = SplatRenderer::OrderSource::gpu;
    frame.ranges = ranges.data();
    frame.rangeCount = static_cast<uint32_t>(ranges.size());
    frame.revealLevel = revealLevel;
    frame.labelStyles = styles;
    auto draw = pass.encode(cmd, slot, inputs.camera->handle(), *inputs.splats, *inputs.labels,
                            *inputs.sh, 0, frame);
    require(draw.has_value(), "GPU frame encode");
    require(draw->capacity <= std::max(1u, capacity), "draw buffer bound");
    VkMemoryBarrier barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    barrier.srcAccessMask = VK_ACCESS_MEMORY_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                         1, &barrier, 0, nullptr, 0, nullptr);
    const VkBufferCopy args{0, 0, sizeof(VkDrawIndirectCommand)};
    const VkBufferCopy order{0, sizeof(VkDrawIndirectCommand), draw->capacity * 4ull};
    const VkBufferCopy projected{0, sizeof(VkDrawIndirectCommand) + orderBytes,
                                 draw->capacity * sizeof(ProjectedSplat)};
    vkCmdCopyBuffer(cmd, draw->arguments, copy->handle(), 1, &args);
    vkCmdCopyBuffer(cmd, draw->order, copy->handle(), 1, &order);
    vkCmdCopyBuffer(cmd, draw->projected, copy->handle(), 1, &projected);
  });
  auto data = gpu.readback(*copy, bytes);
  VkDrawIndirectCommand args{};
  std::memcpy(&args, data.data(), sizeof(args));
  require(args.vertexCount == 4 && args.instanceCount <= capacity && args.firstVertex == 0 &&
              args.firstInstance == 0,
          "GPU draw arguments bounded and initialized");
  // The draw order holds positions in the projected records, which name the source splats.
  std::vector<uint32_t> indices(args.instanceCount);
  std::vector<ProjectedSplat> records(capacity);
  if (!indices.empty()) {
    std::memcpy(indices.data(), data.data() + sizeof(args), indices.size() * sizeof(uint32_t));
    std::memcpy(records.data(), data.data() + sizeof(args) + orderBytes,
                records.size() * sizeof(ProjectedSplat));
  }
  for (uint32_t& index : indices) {
    require(index < capacity, "draw order within the projected records");
    index = records[index].index;
  }
  return indices;
}

// The renderer compiles one set and every world borrows it, so a world's teardown must leave
// the set to the next world.
void sharedPipelines(const test::VulkanTestContext& gpu, const splat::LodTree& tree,
                     const Inputs& lodInputs) {
  const auto shared = VulkanFrameCompute::Pipelines::compile(*gpu.context);
  require(shared.has_value(), "compile the frame pipelines");
  for (const uint32_t budget : {1u, 2u}) {
    auto created = VulkanFrameCompute::create(*gpu.context, *shared, 3, &tree, budget);
    require(static_cast<bool>(created), "create GPU LOD frame on shared pipelines");
    auto pass = std::move(created.value());
    require(pass->pipelines() == *shared, "a world borrows the shared pipelines");
    const auto cut = budget == 1 ? std::vector<uint32_t>{0} : std::vector<uint32_t>{2, 1};
    require(run(gpu, *pass, lodInputs, 0, budget, {}) == cut,
            "a hierarchy world on shared pipelines orders like one on its own");
  }
  {
    auto created = VulkanFrameCompute::create(*gpu.context, *shared, 3);
    require(static_cast<bool>(created), "create GPU frame on shared pipelines");
    const std::vector<uint32_t> back{2, 0, 1};
    require(run(gpu, *created.value(), lodInputs, 1, 3, {{0, 3}}) == back,
            "a flat world after hierarchy worlds orders like one on its own");
  }
  std::puts("PASS worlds built one after another share one pipeline set");
}

void tests(const test::VulkanTestContext& gpu) {
  auto source = cloud(257);
  Inputs inputs(gpu, source);
  const std::vector<SplatRenderer::Range> ranges{{100, 40}, {0, 10}, {240, 17}};
  std::vector<uint32_t> expected;
  for (auto range : ranges)
    for (uint32_t i = 0; i < range.count; ++i) expected.push_back(range.offset + i);
  std::sort(expected.rbegin(), expected.rend());
  for (const SortKeyBits bits : {SortKeyBits::full32, SortKeyBits::low16}) {
    auto created = VulkanFrameCompute::create(*gpu.context, 257);
    require(static_cast<bool>(created), "create GPU frame");
    auto pass = std::move(created.value());
    RenderPolicy policy;
    policy.sortDepth = bits;
    std::string reason;
    require(pass->applyRenderPolicy(policy, &reason), "apply sort depth policy");
    require(pass->sortKeyBits() == static_cast<uint32_t>(bits), "requested sort depth in effect");
    const auto actual = run(gpu, *pass, inputs, 0, 257, ranges);
    if (actual != expected) {
      std::fprintf(stderr, "range ordering: expected %zu, got %zu\n", expected.size(),
                   actual.size());
      for (size_t i = 0; i < actual.size(); ++i)
        std::fprintf(stderr, "%zu: expected %u, got %u\n", i,
                     i < expected.size() ? expected[i] : UINT32_MAX, actual[i]);
    }
    require(actual == expected, "back-to-front range ordering");
    require(run(gpu, *pass, inputs, 1, 257, {}).empty(), "empty ranges draw nothing");
    require(run(gpu, *pass, inputs, 0, 257, ranges) == expected, "slot reuse ordering");
    require(pass->stats().drawn == expected.size() && pass->stats().status == 0,
            "delayed diagnostics match completed GPU count");
    inputs.setView(100);
    require(run(gpu, *pass, inputs, 1, 257, ranges).empty(), "offscreen ranges draw nothing");
    require(pass->stats().drawn == 0, "zero drawn remains zero with a loaded source");
    inputs.setView(0);
    require(run(gpu, *pass, inputs, 0, 257, ranges) == expected, "visibility recovers");
    // Field Guide: the frame's reveal and part styles reach the slot's guide.
    constexpr float kBelowEverySplat = -1;
    require(run(gpu, *pass, inputs, 1, 257, ranges, kBelowEverySplat).empty(),
            "the frame's reveal clips every splat above it");
    LabelStyles hidden{};
    hidden[0].opacity = 0;
    require(run(gpu, *pass, inputs, 0, 257, ranges, kNoReveal, &hidden).empty(),
            "the frame's styles hide label 0");
    require(run(gpu, *pass, inputs, 1, 257, ranges) == expected, "the next frame draws again");
    gpu.submit([&](VkCommandBuffer cmd) {
      SplatRenderer::Frame frame;
      frame.orderSource = SplatRenderer::OrderSource::gpu;
      const SplatRenderer::Range overlap[]{{0, 2}, {1, 2}};
      frame.ranges = overlap;
      frame.rangeCount = 2;
      require(!pass->encode(cmd, 1, inputs.camera->handle(), *inputs.splats, *inputs.labels,
                            *inputs.sh, 0, frame),
              "overlapping residency ranges rejected");
      frame.rangeCount = 0;
      require(!pass->encode(cmd, 2, inputs.camera->handle(), *inputs.splats, *inputs.labels,
                            *inputs.sh, 0, frame),
              "invalid frame slot rejected");
    });
    std::printf("PASS %u-bit visibility/sort/indirect chain, ranges, empty view and diagnostics\n",
                pass->sortKeyBits());
  }

  // A still scene encodes no new frame, so finished frames must report without a re-encode.
  {
    auto created = VulkanFrameCompute::create(*gpu.context, 257);
    require(static_cast<bool>(created), "create GPU frame for completion");
    auto pass = std::move(created.value());
    require(run(gpu, *pass, inputs, 0, 257, ranges) == expected, "completion frame ordering");
    pass->submitted(0, 1);
    pass->collectCompleted(0);
    require(pass->stats().drawn == 0, "unfinished submission is not read");
    pass->collectCompleted(1);
    require(pass->stats().drawn == expected.size(), "finished frame read without re-encode");
    inputs.setView(100);
    require(run(gpu, *pass, inputs, 1, 257, ranges).empty(), "offscreen completion frame");
    pass->submitted(1, 2);
    inputs.setView(0);
    require(run(gpu, *pass, inputs, 0, 257, ranges) == expected, "newest completion frame");
    pass->submitted(0, 3);
    pass->collectCompleted(3);
    require(pass->stats().drawn == expected.size(), "newest finished frame wins");
    // Slot 1 now holds the older frame: reading it after slot 0 must not move stats back.
    require(run(gpu, *pass, inputs, 1, 257, ranges) == expected, "older completion frame");
    pass->submitted(1, 4);
    inputs.setView(100);
    require(run(gpu, *pass, inputs, 0, 257, ranges).empty(), "newer offscreen completion frame");
    pass->submitted(0, 5);
    inputs.setView(0);
    pass->collectCompleted(5);
    require(pass->stats().drawn == 0, "older slot never overwrites a newer frame");
  }
  std::puts("PASS finished frames report diagnostics without a re-encode, newest first");

  splat::LodTree tree;
  tree.leafCount = 2;
  tree.layout = {{{0, 0, -3}, 4, 1, 2}, {{0, 0, -1}, 0.2f, 0, 0}, {{0, 0, -5}, 0.2f, 0, 0}};
  tree.nodes = cloud(3);
  tree.nodes.positions = {0, 0, -3, 0, 0, -1, 0, 0, -5};
  tree.nodes.covariances[0] = tree.nodes.covariances[3] = tree.nodes.covariances[5] = 1;
  tree.selection = splat::buildLodSelectionData(tree);
  const Inputs lodInputs(gpu, tree.nodes);
  for (const uint32_t budget : {1u, 2u}) {
    auto created = VulkanFrameCompute::create(*gpu.context, 3, &tree, budget);
    require(static_cast<bool>(created), "create GPU LOD frame");
    auto pass = std::move(created.value());
    require(pass->hasLod(), "hierarchy is GPU selected");
    const auto cut = budget == 1 ? std::vector<uint32_t>{0} : std::vector<uint32_t>{2, 1};
    require(run(gpu, *pass, lodInputs, 0, budget, {}) == cut,
            "LOD GPU count feeds visibility/sort");
    require(run(gpu, *pass, lodInputs, 0, budget, {}) == cut, "LOD slot reuse");
    require(pass->stats().selected == budget && pass->stats().drawn == budget &&
                pass->stats().status == 0,
            "LOD completed diagnostics");
  }
  std::puts("PASS hierarchical selection feeds sorted indirect draw with covering pressure");

  sharedPipelines(gpu, tree, lodInputs);

  // One root over 64 leaves: the policy threshold picks the root or every leaf, live.
  splat::LodTree flat;
  flat.leafCount = kPolicyLeaves;
  flat.layout.push_back({{0, 0, -3}, 1, 1, kPolicyLeaves});
  for (uint32_t i = 0; i < kPolicyLeaves; ++i)
    flat.layout.push_back({{-0.5f + i / static_cast<float>(kPolicyLeaves), 0, -3}, 0.05f, 0, 0});
  flat.nodes = cloud(kPolicyLeaves + 1);
  for (uint32_t i = 0; i < flat.layout.size(); ++i)
    std::copy_n(flat.layout[i].position, 3, flat.nodes.positions.begin() + 3 * i);
  flat.selection = splat::buildLodSelectionData(flat);
  const Inputs flatInputs(gpu, flat.nodes);
  {
    auto created =
        VulkanFrameCompute::create(*gpu.context, kPolicyLeaves + 1, &flat, kPolicyLeaves);
    require(static_cast<bool>(created), "create GPU LOD frame for the policy");
    auto pass = std::move(created.value());
    uint64_t submission = 0;
    const auto apply = [&](float pixels, uint32_t limit) {
      RenderPolicy policy;
      policy.lodErrorPixels = pixels;
      policy.lodSplatLimit = limit;
      std::string reason;
      require(pass->applyRenderPolicy(policy, &reason), "apply LOD policy");
    };
    const auto frame = [&](uint32_t slot) {
      run(gpu, *pass, flatInputs, slot, kPolicyLeaves, {});
      pass->submitted(slot, ++submission);
      pass->collectCompleted(submission);
    };
    apply(kCoarsestPixels, 0);
    frame(0);
    require(pass->stats().selected == 1 && pass->stats().drawn == 1,
            "a coarse policy keeps the root");
    apply(kFinestPixels, 0);
    frame(1);
    require(pass->stats().selected == kPolicyLeaves && pass->stats().drawn == kPolicyLeaves &&
                pass->stats().evaluated == 1,
            "a fine policy refines to every leaf at once");
    // A limit below the refined cut denies the split and raises the threshold; lifting it
    // restores the policy's threshold at once.
    apply(kFinestPixels, kPolicyLeaves / 2);
    for (uint32_t i = 0; i < 4; ++i) frame(i % splatkit::kFramesInFlight);
    require(pass->stats().selected == 1 && pass->stats().limited > 0,
            "a splat limit below the cut denies the refinement");
    require(pass->lodPixels() > kFinestPixels, "denied refinements raise the threshold");
    apply(kFinestPixels, 0);
    require(pass->lodPixels() == kFinestPixels, "a new policy resets the threshold");
    frame(0);
    require(pass->stats().selected == kPolicyLeaves, "lifting the limit refines again");
  }
  std::puts("PASS the LOD threshold and splat limit apply live and the threshold adapts");
  gpu.requireValidationClean();
}
}  // namespace

int main() {
  try {
    test::VulkanTestContext gpu;
    std::printf("GPU: %s; validation: %s\n", gpu.context->deviceDescription().c_str(),
                gpu.context->validationEnabled() ? "on" : "off");
    tests(gpu);
    return 0;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "FAIL %s\n", e.what());
    return 1;
  }
}

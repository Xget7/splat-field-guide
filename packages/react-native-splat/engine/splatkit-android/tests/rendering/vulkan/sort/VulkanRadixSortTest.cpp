#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <numeric>
#include <random>
#include <vector>

#include "rendering/vulkan/sort/VulkanRadixSort.h"
#include "support/VulkanTestContext.h"

using splatkit::keyBitCount;
using splatkit::KeyBits;
using splatkit::kFramesInFlight;
using splatkit::VulkanBuffer;
using splatkit::VulkanRadixSort;
using splatkit::test::require;
using splatkit::test::VulkanTestContext;

namespace {
std::vector<uint32_t> read(VulkanTestContext& gpu, VkBuffer source, uint32_t count) {
  if (!count) return {};
  const VkDeviceSize bytes = VkDeviceSize{count} * 4;
  auto staging = VulkanBuffer::deviceLocal(
      *gpu.context, bytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
  require(static_cast<bool>(staging), "readback intermediate allocation");
  gpu.submit([&](VkCommandBuffer cmd) {
    VkMemoryBarrier barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
    barrier.srcAccessMask = VK_ACCESS_MEMORY_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                         1, &barrier, 0, nullptr, 0, nullptr);
    const VkBufferCopy copy{0, 0, bytes};
    vkCmdCopyBuffer(cmd, source, staging->handle(), 1, &copy);
  });
  auto raw = gpu.readback(*staging, bytes);
  std::vector<uint32_t> result(count);
  std::memcpy(result.data(), raw.data(), raw.size());
  return result;
}

struct Config {
  bool large = false;
  bool tiny = false;
  uint32_t capacity = 0;
};

Config configFromEnvironment() {
  Config config;
  config.large = std::getenv("SPLATKIT_RADIX_LARGE") != nullptr;
  config.tiny = std::getenv("SPLATKIT_RADIX_TINY") != nullptr;
  config.capacity = config.tiny ? 257 : config.large ? VulkanRadixSort::kMaxCapacity : 262145;
  return config;
}

struct InputBuffers {
  std::unique_ptr<VulkanBuffer> keys, values, count;
  VkDeviceSize bytes = 0;
};

InputBuffers allocateInputs(VulkanTestContext& gpu, uint32_t capacity) {
  InputBuffers buffers;
  buffers.bytes = VkDeviceSize{capacity} * 4;
  buffers.keys =
      VulkanBuffer::deviceLocal(*gpu.context, buffers.bytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  buffers.values =
      VulkanBuffer::deviceLocal(*gpu.context, buffers.bytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  buffers.count = VulkanBuffer::deviceLocal(*gpu.context, 4, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  require(buffers.keys && buffers.values && buffers.count, "allocate input");
  return buffers;
}

VulkanRadixSort::Input inputFor(const InputBuffers& buffers) {
  VulkanRadixSort::Input input;
  input.keys = buffers.keys->handle();
  input.values = buffers.values->handle();
  input.count = buffers.count->handle();
  input.keysBytes = buffers.bytes;
  input.valuesBytes = buffers.bytes;
  return input;
}

void requireReserveBehavior(VulkanRadixSort& sort) {
  require(sort.output(0).values == VK_NULL_HANDLE, "unreserved output");
  std::puts("radix stage=reserve-one");
  require(sort.reserve(0) && sort.capacity() == 1, "zero reserve");
  auto* const old = sort.output(0).values;
  require(!sort.reserve(VulkanRadixSort::kMaxCapacity + 1), "reject oversized capacity");
  require(sort.capacity() == 1 && sort.output(0).values == old, "transactional reserve failure");
}

void requireInvalidInputsRejected(VulkanTestContext& gpu, const VulkanRadixSort& sort,
                                  const VulkanRadixSort::Input& input) {
  require(!sort.encode(VK_NULL_HANDLE, 0, input), "reject null command buffer");
  gpu.submit([&](VkCommandBuffer cmd) {
    require(!sort.encode(cmd, kFramesInFlight, input), "reject invalid slot");
    auto bad = input;
    bad.keysBytes = input.keysBytes - 1;
    require(!sort.encode(cmd, 0, bad), "reject undersized input");
    bad = input;
    bad.keysOffset = 1;
    require(!sort.encode(cmd, 0, bad), "reject misaligned offset");
    bad = input;
    // Fixed uint32_t underlying type permits this value; exercise enum validation.
    // NOLINTNEXTLINE(clang-analyzer-optin.core.EnumCastOutOfRange)
    bad.keyBits = static_cast<KeyBits>(9);
    require(!sort.encode(cmd, 0, bad), "reject key mode");
    bad = input;
    bad.keys = sort.output(1).values;
    require(!sort.encode(cmd, 0, bad), "reject owned output alias");
  });
}

std::vector<uint32_t> caseSizes(const Config& config) {
  std::vector<uint32_t> sizes{0, 1, 31, 32, 33, 63, 64, 65, 67, 127, 128, 129, 257};
  if (!config.tiny) sizes.insert(sizes.end(), {2047, 2048, 2049, 4097, 262145});
  if (config.large && !config.tiny) sizes.push_back(config.capacity);
  return sizes;
}

// Mixed full-width values, many duplicates, all-equal and ascending-depth input.
uint32_t patternKey(uint32_t pattern, uint32_t index, std::mt19937& random) {
  if (pattern == 0) return random();
  if (pattern == 1) return random() % 17;
  if (pattern == 2) return 42;
  const float depth = 1.0f + index * 0.02f;
  uint32_t bits = 0;
  std::memcpy(&bits, &depth, sizeof(depth));
  return ~bits;
}

std::vector<uint32_t> makeKeys(uint32_t n, uint32_t pattern, bool low16, std::mt19937& random) {
  std::vector<uint32_t> keys(n);
  for (uint32_t i = 0; i < n; ++i) {
    keys[i] = patternKey(pattern, i, random);
    if (low16) keys[i] = (keys[i] & 65535u) | (random() & 0xffff0000u);
  }
  return keys;
}

void requireSortedOutput(VulkanTestContext& gpu, const VulkanRadixSort::Output& output, uint32_t n,
                         const std::vector<uint32_t>& expected) {
  std::puts("radix stage=readback-metadata");
  require(read(gpu, output.count, 1)[0] == n, "output count");
  require(read(gpu, output.status, 1)[0] == 0, "output status");
  std::puts("radix stage=readback-values");
  const auto actualValues = read(gpu, output.values, n);
  std::puts("radix stage=compare");
  require(actualValues == expected, "stable permutation differs from CPU stable_sort");
}

// Sorts n pattern keys on the GPU and compares with a CPU stable_sort. `cases` counts the
// cases run and picks the slot.
void runCase(VulkanTestContext& gpu, const VulkanRadixSort& sort, const InputBuffers& buffers,
             const VulkanRadixSort::Input& input, uint32_t n, uint32_t pattern,
             std::mt19937& random, uint32_t& cases) {
  const bool low16 = input.keyBits == KeyBits::low16;
  std::printf("radix case=%u bits=%u n=%u pattern=%u stage=upload\n", cases,
              keyBitCount(input.keyBits), n, pattern);
  const auto inKeys = makeKeys(n, pattern, low16, random);
  std::vector<uint32_t> inValues(n);
  std::vector<uint32_t> expected(n);
  std::iota(inValues.begin(), inValues.end(), 0);
  std::iota(expected.begin(), expected.end(), 0);
  require(buffers.keys->upload(inKeys.data(), VkDeviceSize{n} * 4), "upload keys");
  require(buffers.values->upload(inValues.data(), VkDeviceSize{n} * 4), "upload values");
  require(buffers.count->upload(&n, 4), "upload count");
  const uint32_t mask = low16 ? 65535u : UINT32_MAX;
  std::stable_sort(expected.begin(), expected.end(),
                   [&](uint32_t a, uint32_t b) { return (inKeys[a] & mask) < (inKeys[b] & mask); });
  const uint32_t slot = cases++ % kFramesInFlight;
  std::puts("radix stage=encode-submit-wait");
  gpu.submit([&](VkCommandBuffer cmd) { require(sort.encode(cmd, slot, input), "encode radix"); });
  requireSortedOutput(gpu, sort.output(slot), n, expected);
}

uint32_t runAllCases(VulkanTestContext& gpu, const VulkanRadixSort& sort,
                     const InputBuffers& buffers, VulkanRadixSort::Input& input,
                     const std::vector<uint32_t>& sizes) {
  std::mt19937 random(0x51a7u);
  uint32_t cases = 0;
  for (const auto bits : {KeyBits::full32, KeyBits::low16}) {
    input.keyBits = bits;
    for (const uint32_t n : sizes)
      for (uint32_t pattern = 0; pattern < 4; ++pattern)
        runCase(gpu, sort, buffers, input, n, pattern, random, cases);
  }
  return cases;
}

void requireInvalidCountFailsClosed(VulkanTestContext& gpu, const VulkanRadixSort& sort,
                                    const InputBuffers& buffers,
                                    const VulkanRadixSort::Input& input, uint32_t capacity) {
  const uint32_t overflow = capacity + 1;
  require(buffers.count->upload(&overflow, 4), "upload invalid count");
  gpu.submit(
      [&](VkCommandBuffer cmd) { require(sort.encode(cmd, 0, input), "encode invalid count"); });
  require(read(gpu, sort.output(0).count, 1)[0] == 0, "invalid count fails closed");
  require(read(gpu, sort.output(0).status, 1)[0] == VulkanRadixSort::kInvalidCount,
          "invalid count status");
}

int runSortTests(VulkanTestContext& gpu, VulkanRadixSort& sort) {
  requireReserveBehavior(sort);
  const Config config = configFromEnvironment();
  std::printf("radix stage=reserve capacity=%u\n", config.capacity);
  require(sort.reserve(config.capacity), "reserve test capacity");
  std::puts("radix stage=input-allocation");
  const InputBuffers buffers = allocateInputs(gpu, config.capacity);
  VulkanRadixSort::Input input = inputFor(buffers);
  requireInvalidInputsRejected(gpu, sort, input);
  const uint32_t cases = runAllCases(gpu, sort, buffers, input, caseSizes(config));
  requireInvalidCountFailsClosed(gpu, sort, buffers, input, config.capacity);
  gpu.requireValidationClean();
  std::printf("PASS radix: %u stable-sort cases, invalid inputs/count, reserve, slots; large=%d\n",
              cases, config.large);
  if (!config.large) std::puts("SKIP full-capacity case: set SPLATKIT_RADIX_LARGE=1");
  return 0;
}

int runRadixTests() {
  VulkanTestContext gpu;
  const auto capabilities = VulkanRadixSort::queryCapabilities(*gpu.context);
  std::printf("Radix device: %s; subgroup=%u; supported=%d; %s\n",
              gpu.context->deviceDescription().c_str(), capabilities.subgroupSize,
              capabilities.supported, capabilities.reason.c_str());
  if (!capabilities.supported) {
    require(!VulkanRadixSort::create(*gpu.context), "unsupported create must fail");
    std::puts("SKIP radix GPU cases: unsupported device");
    return 77;
  }
  std::puts("radix stage=create");
  auto result = VulkanRadixSort::create(*gpu.context);
  require(static_cast<bool>(result), "create radix");
  auto sort = std::move(result.value());
  return runSortTests(gpu, *sort);
}
}  // namespace

int main() {
  std::setvbuf(stdout, nullptr, _IONBF, 0);
  try {
    return runRadixTests();
  } catch (const std::exception& error) {
    std::fprintf(stderr, "FAIL radix: %s\n", error.what());
    return 1;
  }
}

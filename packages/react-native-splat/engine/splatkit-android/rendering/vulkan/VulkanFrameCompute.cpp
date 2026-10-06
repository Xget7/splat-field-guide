#include "rendering/vulkan/VulkanFrameCompute.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <utility>

#include "rendering/vulkan/RadixSort.h"
#include "rendering/vulkan/VulkanHelpers.h"
#include "splatkit/Log.h"
#include "splatkit/rendering/GpuLayout.h"
#include "rendering/vulkan/VulkanShaderTypes.h"

namespace splatkit {
namespace {
static_assert(VulkanFrameCompute::kMaxVisible <= RadixSort::kMaxCapacity,
              "the sort must hold every visible splat");
constexpr uint32_t kTimestampCount = 4;
// Words of the diagnostics readback, in the order collect() reads them. Two are spare.
enum ReadbackWord : uint32_t {
  kDrawn,
  kSelected,
  kLimited,
  kEvaluated,
  kVisibilityStatus,
  kSortStatus,
  kReadbackWords = 8
};
constexpr VkDeviceSize kReadbackBytes = kReadbackWords * sizeof(uint32_t);
constexpr VkDeviceSize wordOffset(ReadbackWord word) {
  return word * sizeof(uint32_t);
}
// The sort status rides above the visibility status in one combined word.
constexpr uint32_t kSortStatusShift = 16;
}  // namespace

VulkanFrameCompute::VulkanFrameCompute(const VulkanContext& ctx) : ctx_(ctx) {}

splat::Result<std::unique_ptr<VulkanFrameCompute>> VulkanFrameCompute::create(
    const VulkanContext& ctx, uint32_t sourceCount) {
  std::unique_ptr<VulkanFrameCompute> pass(new VulkanFrameCompute(ctx));
  if (!pass->initialize(sourceCount))
    return splat::Error{splat::ErrorCode::gpuUnavailable, "GPU frame allocation/capability limits"};
  return pass;
}

bool VulkanFrameCompute::initialize(uint32_t sourceCount) {
  sourceCount_ = sourceCount;
  auto visibility = VisibilityPass::create(ctx_, 1.0f);
  if (!visibility) return false;
  visibility_ = std::move(visibility.value());
  if (VkDeviceSize{std::max(1u, sourceCount)} * sizeof(GpuSplat) >
      visibility_->capabilities().maxStorageBufferRange) {
    LOGE("%u splats require %llu bytes, maxStorageBufferRange is %llu", sourceCount,
         static_cast<unsigned long long>(VkDeviceSize{sourceCount} * sizeof(GpuSplat)),
         static_cast<unsigned long long>(visibility_->capabilities().maxStorageBufferRange));
    return false;
  }
  capacity_ = std::max(1u, std::min(sourceCount, kMaxVisible));
  auto radix = RadixSort::create(ctx_);
  if (!radix || !radix.value()->reserve(capacity_) || !visibility_->reserve(capacity_))
    return false;
  radix_ = std::move(radix.value());

  VkPhysicalDeviceProperties properties{};
  vkGetPhysicalDeviceProperties(ctx_.physicalDevice(), &properties);
  uint32_t familyCount = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(ctx_.physicalDevice(), &familyCount, nullptr);
  std::vector<VkQueueFamilyProperties> families(familyCount);
  vkGetPhysicalDeviceQueueFamilyProperties(ctx_.physicalDevice(), &familyCount, families.data());
  timestampBits_ = families[ctx_.queueFamily()].timestampValidBits;
  timestampPeriod_ = properties.limits.timestampPeriod;
  if (!properties.limits.timestampComputeAndGraphics) timestampBits_ = 0;
  for (uint32_t slot = 0; slot < kSlots; ++slot) {
    readback_[slot] =
        GpuBuffer::hostVisible(ctx_, kReadbackBytes, VK_BUFFER_USAGE_TRANSFER_DST_BIT);
    if (!readback_[slot]) return false;
    if (timestampBits_) {
      VkQueryPoolCreateInfo info{VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO};
      info.queryType = VK_QUERY_TYPE_TIMESTAMP;
      info.queryCount = kTimestampCount;
      if (vkCreateQueryPool(ctx_.device(), &info, nullptr, &queries_[slot]) != VK_SUCCESS)
        return false;
    }
  }
  return true;
}

VulkanFrameCompute::~VulkanFrameCompute() {
  for (VkQueryPool pool : queries_)
    if (pool) vkDestroyQueryPool(ctx_.device(), pool, nullptr);
}

void VulkanFrameCompute::submitted(uint32_t slot, uint64_t submission) {
  if (slot < kSlots && pending_[slot]) submission_[slot] = submission;
}

void VulkanFrameCompute::collectCompleted(uint64_t completedSubmission) {
  for (uint32_t slot = 0; slot < kSlots; ++slot) {
    if (pending_[slot] && submission_[slot] != 0 && submission_[slot] <= completedSubmission)
      collect(slot);
  }
}

void VulkanFrameCompute::collect(uint32_t slot) {
  if (!pending_[slot]) return;
  pending_[slot] = false;
  const uint64_t submission = std::exchange(submission_[slot], 0);
  // Slots finish in submission order but are read in slot order: skip an older frame.
  if (submission != 0 && submission < collectedSubmission_) return;
  collectedSubmission_ = std::max(collectedSubmission_, submission);
  readback_[slot]->invalidate(0, kReadbackBytes);
  const auto* words = static_cast<const uint32_t*>(readback_[slot]->mapped());
  stats_.drawn = words[kDrawn];
  stats_.selected = words[kSelected];
  stats_.limited = words[kLimited];
  stats_.evaluated = words[kEvaluated];
  stats_.status = words[kVisibilityStatus] | (words[kSortStatus] << kSortStatusShift);
  if (stats_.status) LOGE("Vulkan GPU frame rejected: diagnostic bits 0x%x", stats_.status);
  if (!queries_[slot]) return;
  uint64_t ticks[kTimestampCount]{};
  if (vkGetQueryPoolResults(ctx_.device(), queries_[slot], 0, kTimestampCount, sizeof(ticks), ticks,
                            sizeof(uint64_t), VK_QUERY_RESULT_64_BIT) != VK_SUCCESS)
    return;
  const uint64_t mask = timestampBits_ >= 64 ? std::numeric_limits<uint64_t>::max()
                                             : (uint64_t{1} << timestampBits_) - 1;
  const double millis = static_cast<double>(timestampPeriod_) * 1e-6;
  stats_.selectMillis = 0;
  stats_.cullMillis = ((ticks[2] - ticks[1]) & mask) * millis;
  stats_.sortMillis = ((ticks[3] - ticks[2]) & mask) * millis;
}

void VulkanFrameCompute::copyDiagnostics(VkCommandBuffer cmd, uint32_t slot,
                                         const VisibilityPass::Output& visible,
                                         uint32_t candidates) {
  auto* target = readback_[slot]->handle();
  uint32_t words[kReadbackWords]{};
  words[kSelected] = candidates;
  vkCmdUpdateBuffer(cmd, target, 0, sizeof(words), words);
  memoryBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_ACCESS_TRANSFER_WRITE_BIT | VK_ACCESS_SHADER_WRITE_BIT,
                VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_ACCESS_TRANSFER_READ_BIT | VK_ACCESS_TRANSFER_WRITE_BIT);
  const auto copy = [&](VkBuffer source, VkDeviceSize from, VkDeviceSize to, VkDeviceSize bytes) {
    const VkBufferCopy region{from, to, bytes};
    vkCmdCopyBuffer(cmd, source, target, 1, &region);
  };
  const auto sorted = radix_->output(slot);
  copy(sorted.count, 0, wordOffset(kDrawn), sizeof(uint32_t));
  copy(visible.status, 0, wordOffset(kVisibilityStatus), sizeof(uint32_t));
  copy(sorted.status, 0, wordOffset(kSortStatus), sizeof(uint32_t));
  memoryBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT,
                VK_PIPELINE_STAGE_HOST_BIT, VK_ACCESS_HOST_READ_BIT);
  pending_[slot] = true;
  submission_[slot] = 0;
}

std::optional<VulkanFrameCompute::Draw> VulkanFrameCompute::encode(
    VkCommandBuffer cmd, uint32_t slot, VkBuffer camera, const GpuBuffer& splats,
    const SplatRenderer::Frame& frame) {
  if (!cmd || slot >= kSlots || !camera)
    return std::nullopt;
  collect(slot);
  VisibilityPass::Input input;
  input.camera = camera;
  input.splats = splats.handle();
  input.splatsBytes = splats.size();
  input.sourceCount = sourceCount_;
  input.cameraBytes = sizeof(CameraUniform);
  input.candidateCapacity = sourceCount_;
  input.keyOrder = VisibilityPass::KeyOrder::descending;  // Hardware uses back-to-front over.
  memoryBarrier(cmd, VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_UNIFORM_READ_BIT);
  if (queries_[slot]) vkCmdResetQueryPool(cmd, queries_[slot], 0, kTimestampCount);
  const auto timestamp = [&](uint32_t index) {
    if (queries_[slot])
      vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, queries_[slot], index);
  };
  timestamp(0);
  timestamp(1);
  if (!visibility_->encode(cmd, slot, input)) return std::nullopt;
  const auto visible = visibility_->output(slot);
  timestamp(2);
  RadixSort::Input sort;
  sort.keys = visible.depthKeys;
  sort.values = visible.indices;
  sort.count = visible.count;
  sort.keysBytes = sort.valuesBytes = VkDeviceSize{capacity_} * sizeof(uint32_t);
  sort.countBytes = sizeof(uint32_t);
  sort.keyBits = RadixSort::KeyBits::full32;
  if (!radix_->encode(cmd, slot, sort)) return std::nullopt;
  timestamp(3);
  // The sorter's checked GPU count is authoritative even if visibility succeeded.
  memoryBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT,
                VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_ACCESS_TRANSFER_READ_BIT | VK_ACCESS_TRANSFER_WRITE_BIT);
  const VkBufferCopy countToDraw{0, offsetof(VkDrawIndirectCommand, instanceCount),
                                 sizeof(uint32_t)};
  vkCmdCopyBuffer(cmd, radix_->output(slot).count, visible.indirect, 1, &countToDraw);
  memoryBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_WRITE_BIT,
                VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT, VK_ACCESS_INDIRECT_COMMAND_READ_BIT);
  copyDiagnostics(cmd, slot, visible, input.candidateCapacity);
  return Draw{radix_->output(slot).values, visible.indirect, capacity_};
}

}  // namespace splatkit

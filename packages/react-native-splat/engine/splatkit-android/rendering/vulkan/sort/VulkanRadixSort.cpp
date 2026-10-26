#include "rendering/vulkan/sort/VulkanRadixSort.h"

#include <algorithm>
#include <vector>

#include "rendering/vulkan/device/VulkanBarriers.h"
#include "rendering/vulkan/device/VulkanShaderModule.h"
#include "shaders/radix_histogram_comp.h"
#include "shaders/radix_prepare_comp.h"
#include "shaders/radix_scan_comp.h"
#include "shaders/radix_scatter_comp.h"

namespace splatkit {
namespace {
constexpr auto kCompute = VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT;
constexpr auto kShader = VK_SHADER_STAGE_COMPUTE_BIT;
constexpr uint32_t kBindings = 10;
// Every radix shader runs 128 invocations, and each pass sorts one 8-bit digit into 256 buckets.
constexpr uint32_t kThreads = 128;
constexpr uint32_t kDigitBits = 8;
constexpr uint32_t kBuckets = 1u << kDigitBits;
constexpr VkDeviceSize kWord = sizeof(uint32_t);
// The scatter shader holds 4 masks and 3 base tables of kBuckets words each.
constexpr uint32_t kScatterSharedBytes = (4 + 3) * kBuckets * sizeof(uint32_t);
// The indirect dispatch arguments groupsX, groupsY and groupsZ, then the block count.
constexpr VkDeviceSize kStateBytes = 4 * sizeof(uint32_t);
struct PushConstants {
  uint32_t capacity, shift, maxGroupsX;
};
static_assert(sizeof(PushConstants) == 12, "must match the Push block of every radix shader");
constexpr VkBufferUsageFlags kStorage =
    VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT;

VkDescriptorBufferInfo wholeBuffer(const std::unique_ptr<VulkanBuffer>& buffer) {
  return {buffer->handle(), 0, buffer->size()};
}

// First pass reads the external input, then the two scratch sets alternate.
uint32_t passSet(uint32_t pass) {
  if (pass == 0) return 0;
  return pass & 1 ? 1 : 2;
}

void computeBarrier(VkCommandBuffer cmd) {
  vulkanMemoryBarrier(cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT, kCompute,
                      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
}

// Bind after each pipeline transition: MoltenVK/gfxstream otherwise retained stale
// encoded state when a different compute layout (visibility) preceded this pass.
// VulkanFrameComputeTest covers the complete producer-to-sort chain.
void bindStage(VkCommandBuffer cmd, VkPipelineLayout layout, VkPipeline pipeline,
               VkDescriptorSet set, const PushConstants& push) {
  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, layout, 0, 1, &set, 0, nullptr);
  vkCmdPushConstants(cmd, layout, kShader, 0, sizeof(push), &push);
}
}  // namespace

VulkanRadixSort::Capabilities VulkanRadixSort::queryCapabilities(const VulkanContext& ctx) {
  Capabilities result;
  VkPhysicalDeviceSubgroupProperties subgroup{
      VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES};
  VkPhysicalDeviceProperties2 properties{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
  properties.pNext = &subgroup;
  vkGetPhysicalDeviceProperties2(ctx.physicalDevice(), &properties);
  const auto& limits = properties.properties.limits;
  result.subgroupSize = subgroup.subgroupSize;
  uint32_t count = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice(), &count, nullptr);
  std::vector<VkQueueFamilyProperties> queues(count);
  vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice(), &count, queues.data());
  constexpr VkSubgroupFeatureFlags kRequired = VK_SUBGROUP_FEATURE_BASIC_BIT |
                                               VK_SUBGROUP_FEATURE_ARITHMETIC_BIT |
                                               VK_SUBGROUP_FEATURE_BALLOT_BIT;
  if (ctx.queueFamily() >= count ||
      !(queues[ctx.queueFamily()].queueFlags & VK_QUEUE_COMPUTE_BIT)) {
    result.reason = "selected queue lacks compute";
  } else if (!(subgroup.supportedStages & kShader) ||
             (subgroup.supportedOperations & kRequired) != kRequired || !subgroup.subgroupSize) {
    result.reason = "compute subgroup basic/arithmetic/ballot unavailable";
  } else if (limits.maxComputeWorkGroupInvocations < kThreads ||
             limits.maxComputeWorkGroupSize[0] < kThreads ||
             limits.maxComputeSharedMemorySize < kScatterSharedBytes ||
             !limits.maxComputeWorkGroupCount[0] || !limits.maxComputeWorkGroupCount[1] ||
             !limits.maxComputeWorkGroupCount[2]) {
    result.reason = "compute workgroup/shared-memory limits too small";
  } else if (limits.maxPerStageDescriptorStorageBuffers < kBindings ||
             limits.maxDescriptorSetStorageBuffers < kBindings ||
             limits.maxPerStageResources < kBindings ||
             limits.maxPushConstantsSize < sizeof(PushConstants) ||
             limits.maxStorageBufferRange < kBuckets * kWord ||
             uint64_t{limits.maxComputeWorkGroupCount[0]} * limits.maxComputeWorkGroupCount[1] <
                 kBuckets) {
    result.reason = "descriptor/range/dispatch limits too small";
  } else {
    result.supported = true;
    result.reason = "shared histogram and stable workgroup bit-mask scatter available";
  }
  return result;
}

std::shared_ptr<const VulkanRadixSort::Pipelines> VulkanRadixSort::Pipelines::compile(
    const VulkanContext& ctx) {
  if (!queryCapabilities(ctx).supported) return nullptr;
  auto* const device = ctx.device();
  auto pipelines = std::make_shared<Pipelines>(device);
  std::array<VkDescriptorSetLayoutBinding, kBindings> bindings{};
  for (uint32_t i = 0; i < kBindings; ++i)
    bindings[i] = {i, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, kShader, nullptr};
  VkDescriptorSetLayoutCreateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  setInfo.bindingCount = kBindings;
  setInfo.pBindings = bindings.data();
  if (vkCreateDescriptorSetLayout(device, &setInfo, nullptr, &pipelines->set) != VK_SUCCESS)
    return nullptr;
  const VkPushConstantRange push{kShader, 0, sizeof(PushConstants)};
  VkPipelineLayoutCreateInfo layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  layout.setLayoutCount = 1;
  layout.pSetLayouts = &pipelines->set;
  layout.pushConstantRangeCount = 1;
  layout.pPushConstantRanges = &push;
  if (vkCreatePipelineLayout(device, &layout, nullptr, &pipelines->layout) != VK_SUCCESS)
    return nullptr;
  // Indexed by Stage.
  const uint32_t* code[] = {shaders::radix_prepare_comp, shaders::radix_histogram_comp,
                            shaders::radix_scan_comp, shaders::radix_scatter_comp,
                            shaders::radix_scatter_comp};
  const size_t sizes[] = {shaders::radix_prepare_comp_size, shaders::radix_histogram_comp_size,
                          shaders::radix_scan_comp_size, shaders::radix_scatter_comp_size,
                          shaders::radix_scatter_comp_size};
  // constant_id 0 of radix_scatter.comp: LAST_PASS, a 32-bit VkBool32.
  const VkBool32 lastPass = VK_TRUE;
  const VkSpecializationMapEntry lastPassEntry{0, 0, sizeof(lastPass)};
  const VkSpecializationInfo lastPassInfo{1, &lastPassEntry, sizeof(lastPass), &lastPass};
  for (uint32_t i = 0; i < kStageCount; ++i) {
    const VulkanShaderModule module(device, code[i], sizes[i]);
    if (!module) return nullptr;
    VkComputePipelineCreateInfo pipeline{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    pipeline.stage = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    pipeline.stage.stage = kShader;
    pipeline.stage.module = module.get();
    pipeline.stage.pName = "main";
    if (i == kScatterLast) pipeline.stage.pSpecializationInfo = &lastPassInfo;
    pipeline.layout = pipelines->layout;
    const auto result = vkCreateComputePipelines(device, ctx.pipelineCache(), 1, &pipeline, nullptr,
                                                 &pipelines->stages[i]);
    if (result != VK_SUCCESS) return nullptr;
  }
  return pipelines;
}

VulkanRadixSort::Pipelines::~Pipelines() {
  for (auto* pipeline : stages)
    if (pipeline) vkDestroyPipeline(device, pipeline, nullptr);
  if (layout) vkDestroyPipelineLayout(device, layout, nullptr);
  if (set) vkDestroyDescriptorSetLayout(device, set, nullptr);
}

splat::Result<std::unique_ptr<VulkanRadixSort>> VulkanRadixSort::create(const VulkanContext& ctx) {
  return create(ctx, Pipelines::compile(ctx));
}

splat::Result<std::unique_ptr<VulkanRadixSort>> VulkanRadixSort::create(
    const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines) {
  auto capabilities = queryCapabilities(ctx);
  if (!capabilities.supported)
    return splat::Error{splat::ErrorCode::gpuUnavailable, "radix: " + capabilities.reason};
  if (!pipelines) return splat::Error{splat::ErrorCode::gpuUnavailable, "radix pipeline"};
  std::unique_ptr<VulkanRadixSort> sort(new VulkanRadixSort(ctx, std::move(pipelines)));
  if (!sort->allocateSets())
    return splat::Error{splat::ErrorCode::gpuUnavailable, "radix descriptor allocation"};
  return sort;
}

VulkanRadixSort::~VulkanRadixSort() {
  if (pool_) vkDestroyDescriptorPool(ctx_.device(), pool_, nullptr);
}

bool VulkanRadixSort::allocateSets() {
  auto* const device = ctx_.device();
  const VkDescriptorPoolSize size{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
                                  kBindings * kFramesInFlight * kSets};
  VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  poolInfo.maxSets = kFramesInFlight * kSets;
  poolInfo.poolSizeCount = 1;
  poolInfo.pPoolSizes = &size;
  if (vkCreateDescriptorPool(device, &poolInfo, nullptr, &pool_) != VK_SUCCESS) return false;
  std::array<VkDescriptorSetLayout, kSets> layouts{};
  layouts.fill(pipelines_->set);
  for (auto& sets : sets_) {
    VkDescriptorSetAllocateInfo info{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    info.descriptorPool = pool_;
    info.descriptorSetCount = kSets;
    info.pSetLayouts = layouts.data();
    if (vkAllocateDescriptorSets(device, &info, sets.data()) != VK_SUCCESS) return false;
  }
  return true;
}

bool VulkanRadixSort::reserve(uint32_t capacity) {
  capacity = std::max(capacity, 1u);
  if (capacity > kMaxCapacity) return false;
  if (capacity <= capacity_) return true;
  const auto& limits = ctx_.vkbDevice().physical_device.properties.limits;
  const VkDeviceSize pairBytes = VkDeviceSize{capacity} * kWord;
  const uint32_t blocks = (capacity + kBlock - 1) / kBlock;
  const VkDeviceSize histogramBytes = VkDeviceSize{blocks} * kBuckets * kWord;
  if (pairBytes > limits.maxStorageBufferRange || histogramBytes > limits.maxStorageBufferRange ||
      uint64_t{blocks} >
          uint64_t{limits.maxComputeWorkGroupCount[0]} * limits.maxComputeWorkGroupCount[1])
    return false;
  std::array<Slot, kFramesInFlight> next;
  for (auto& slot : next) {
    for (auto& keys : slot.keys) keys = VulkanBuffer::deviceLocal(ctx_, pairBytes, kStorage);
    for (auto& values : slot.values) values = VulkanBuffer::deviceLocal(ctx_, pairBytes, kStorage);
    slot.histogram = VulkanBuffer::deviceLocal(ctx_, histogramBytes, kStorage);
    slot.totals = VulkanBuffer::deviceLocal(ctx_, kBuckets * kWord, kStorage);
    slot.state = VulkanBuffer::deviceLocal(ctx_, kStateBytes,
                                           kStorage | VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT);
    slot.count = VulkanBuffer::deviceLocal(ctx_, kWord, kStorage);
    slot.status = VulkanBuffer::deviceLocal(ctx_, kWord, kStorage);
    if (!slot.keys[0] || !slot.keys[1] || !slot.values[0] || !slot.values[1] || !slot.histogram ||
        !slot.totals || !slot.state || !slot.count || !slot.status)
      return false;
  }
  slots_ = std::move(next);
  capacity_ = capacity;
  return true;
}

VulkanRadixSort::Output VulkanRadixSort::output(uint32_t slot) const {
  if (slot >= kFramesInFlight || !capacity_) return {};
  const auto& s = slots_[slot];
  return {s.values[0]->handle(), s.count->handle(), s.status->handle()};
}

bool VulkanRadixSort::Slot::owns(VkBuffer buffer) const {
  return buffer == keys[0]->handle() || buffer == keys[1]->handle() ||
         buffer == values[0]->handle() || buffer == values[1]->handle() ||
         buffer == count->handle() || buffer == status->handle() || buffer == state->handle() ||
         buffer == histogram->handle() || buffer == totals->handle();
}

bool VulkanRadixSort::ownsBuffer(VkBuffer buffer) const {
  for (const auto& slot : slots_)
    if (slot.owns(buffer)) return true;
  return false;
}

bool VulkanRadixSort::acceptsRange(VkBuffer buffer, VkDeviceSize offset, VkDeviceSize total,
                                   VkDeviceSize range) const {
  const auto& limits = ctx_.vkbDevice().physical_device.properties.limits;
  return buffer && offset <= total && range <= total - offset && offset % kWord == 0 &&
         (!limits.minStorageBufferOffsetAlignment ||
          offset % limits.minStorageBufferOffsetAlignment == 0) &&
         !ownsBuffer(buffer);
}

bool VulkanRadixSort::acceptsInput(const Input& input) const {
  const VkDeviceSize bytes = VkDeviceSize{capacity_} * kWord;
  return acceptsRange(input.keys, input.keysOffset, input.keysBytes, bytes) &&
         acceptsRange(input.values, input.valuesOffset, input.valuesBytes, bytes) &&
         acceptsRange(input.count, input.countOffset, input.countBytes, kWord);
}

void VulkanRadixSort::writeDescriptorSets(uint32_t slot, const Input& input) const {
  const auto& s = slots_[slot];
  const VkDeviceSize bytes = VkDeviceSize{capacity_} * kWord;
  for (uint32_t set = 0; set < kSets; ++set) {
    const uint32_t in = set == 1 ? 1 : 0;
    const uint32_t out = in ^ 1;
    const VkDescriptorBufferInfo infos[kBindings] = {
        set == 0 ? VkDescriptorBufferInfo{input.keys, input.keysOffset, bytes}
                 : wholeBuffer(s.keys[in]),
        set == 0 ? VkDescriptorBufferInfo{input.values, input.valuesOffset, bytes}
                 : wholeBuffer(s.values[in]),
        wholeBuffer(s.keys[out]),
        wholeBuffer(s.values[out]),
        {input.count, input.countOffset, kWord},
        wholeBuffer(s.histogram),
        wholeBuffer(s.totals),
        wholeBuffer(s.state),
        wholeBuffer(s.count),
        wholeBuffer(s.status)};
    VkWriteDescriptorSet writes[kBindings]{};
    for (uint32_t i = 0; i < kBindings; ++i) {
      writes[i] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
      writes[i].dstSet = sets_[slot][set];
      writes[i].dstBinding = i;
      writes[i].descriptorCount = 1;
      writes[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
      writes[i].pBufferInfo = &infos[i];
    }
    vkUpdateDescriptorSets(ctx_.device(), kBindings, writes, 0, nullptr);
  }
}

void VulkanRadixSort::recordSort(VkCommandBuffer cmd, uint32_t slot, KeyBits keyBits) const {
  const auto& limits = ctx_.vkbDevice().physical_device.properties.limits;
  PushConstants push{capacity_, 0, limits.maxComputeWorkGroupCount[0]};
  bindStage(cmd, pipelines_->layout, pipelines_->stages[kPrepare], sets_[slot][0], push);
  vkCmdDispatch(cmd, 1, 1, 1);
  vulkanMemoryBarrier(
      cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT, kCompute | VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_INDIRECT_COMMAND_READ_BIT);
  const VkBuffer state = slots_[slot].state->handle();
  const uint32_t passes = keyBitCount(keyBits) / kDigitBits;
  for (uint32_t pass = 0; pass < passes; ++pass) {
    push.shift = pass * kDigitBits;
    const VkDescriptorSet set = sets_[slot][passSet(pass)];
    bindStage(cmd, pipelines_->layout, pipelines_->stages[kHistogram], set, push);
    vkCmdDispatchIndirect(cmd, state, 0);
    computeBarrier(cmd);
    bindStage(cmd, pipelines_->layout, pipelines_->stages[kScan], set, push);
    const uint32_t scanX = std::min(kBuckets, push.maxGroupsX);
    vkCmdDispatch(cmd, scanX, (kBuckets + scanX - 1) / scanX, 1);
    computeBarrier(cmd);
    bindStage(cmd, pipelines_->layout,
              pipelines_->stages[pass + 1 == passes ? kScatterLast : kScatter], set, push);
    vkCmdDispatchIndirect(cmd, state, 0);
    computeBarrier(cmd);
  }
  vulkanMemoryBarrier(
      cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT,
      kCompute | VK_PIPELINE_STAGE_VERTEX_SHADER_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_TRANSFER_READ_BIT);
}

bool VulkanRadixSort::encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const {
  if (!cmd || slot >= kFramesInFlight || !capacity_ ||
      (input.keyBits != KeyBits::full32 && input.keyBits != KeyBits::low16))
    return false;
  if (!acceptsInput(input)) return false;
  writeDescriptorSets(slot, input);
  vulkanMemoryBarrier(
      cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT | VK_PIPELINE_STAGE_HOST_BIT,
      VK_ACCESS_MEMORY_WRITE_BIT | VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_HOST_WRITE_BIT, kCompute,
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
  recordSort(cmd, slot, input.keyBits);
  return true;
}
}  // namespace splatkit

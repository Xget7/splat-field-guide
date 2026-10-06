#include "rendering/vulkan/RadixSort.h"

#include <algorithm>
#include <vector>

#include "rendering/vulkan/VulkanHelpers.h"
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
}

RadixSort::Capabilities RadixSort::queryCapabilities(const VulkanContext& ctx) {
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

splat::Result<std::unique_ptr<RadixSort>> RadixSort::create(const VulkanContext& ctx) {
  auto capabilities = queryCapabilities(ctx);
  if (!capabilities.supported)
    return splat::Error{splat::ErrorCode::gpuUnavailable, "radix: " + capabilities.reason};
  std::unique_ptr<RadixSort> sort(new RadixSort(ctx));
  if (!sort->initialize())
    return splat::Error{splat::ErrorCode::gpuUnavailable, "radix pipeline allocation"};
  return sort;
}

RadixSort::~RadixSort() {
  for (auto* pipeline : pipelines_)
    if (pipeline) vkDestroyPipeline(ctx_.device(), pipeline, nullptr);
  if (layout_) vkDestroyPipelineLayout(ctx_.device(), layout_, nullptr);
  if (pool_) vkDestroyDescriptorPool(ctx_.device(), pool_, nullptr);
  if (setLayout_) vkDestroyDescriptorSetLayout(ctx_.device(), setLayout_, nullptr);
}

bool RadixSort::initialize() {
  auto* const device = ctx_.device();
  std::array<VkDescriptorSetLayoutBinding, kBindings> bindings{};
  for (uint32_t i = 0; i < kBindings; ++i)
    bindings[i] = {i, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, kShader, nullptr};
  VkDescriptorSetLayoutCreateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  setInfo.bindingCount = kBindings;
  setInfo.pBindings = bindings.data();
  if (vkCreateDescriptorSetLayout(device, &setInfo, nullptr, &setLayout_) != VK_SUCCESS)
    return false;
  const VkDescriptorPoolSize size{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, kBindings * kSlots * kSets};
  VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  poolInfo.maxSets = kSlots * kSets;
  poolInfo.poolSizeCount = 1;
  poolInfo.pPoolSizes = &size;
  if (vkCreateDescriptorPool(device, &poolInfo, nullptr, &pool_) != VK_SUCCESS) return false;
  std::array<VkDescriptorSetLayout, kSets> layouts{};
  layouts.fill(setLayout_);
  for (auto& sets : sets_) {
    VkDescriptorSetAllocateInfo info{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    info.descriptorPool = pool_;
    info.descriptorSetCount = kSets;
    info.pSetLayouts = layouts.data();
    if (vkAllocateDescriptorSets(device, &info, sets.data()) != VK_SUCCESS) return false;
  }
  const VkPushConstantRange push{kShader, 0, sizeof(PushConstants)};
  VkPipelineLayoutCreateInfo layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  layout.setLayoutCount = 1;
  layout.pSetLayouts = &setLayout_;
  layout.pushConstantRangeCount = 1;
  layout.pPushConstantRanges = &push;
  if (vkCreatePipelineLayout(device, &layout, nullptr, &layout_) != VK_SUCCESS) return false;
  const uint32_t* code[] = {shaders::radix_prepare_comp, shaders::radix_histogram_comp,
                            shaders::radix_scan_comp, shaders::radix_scatter_comp};
  const size_t sizes[] = {shaders::radix_prepare_comp_size, shaders::radix_histogram_comp_size,
                          shaders::radix_scan_comp_size, shaders::radix_scatter_comp_size};
  for (uint32_t i = 0; i < kStageCount; ++i) {
    const ShaderModule module(device, code[i], sizes[i]);
    if (!module) return false;
    VkComputePipelineCreateInfo pipeline{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
    pipeline.stage = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
    pipeline.stage.stage = kShader;
    pipeline.stage.module = module.get();
    pipeline.stage.pName = "main";
    pipeline.layout = layout_;
    const auto result =
        vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &pipeline, nullptr, &pipelines_[i]);
    if (result != VK_SUCCESS) return false;
  }
  return true;
}

bool RadixSort::reserve(uint32_t capacity) {
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
  std::array<Slot, kSlots> next;
  for (auto& slot : next) {
    for (auto& keys : slot.keys) keys = GpuBuffer::deviceLocal(ctx_, pairBytes, kStorage);
    for (auto& values : slot.values) values = GpuBuffer::deviceLocal(ctx_, pairBytes, kStorage);
    slot.histogram = GpuBuffer::deviceLocal(ctx_, histogramBytes, kStorage);
    slot.totals = GpuBuffer::deviceLocal(ctx_, kBuckets * kWord, kStorage);
    slot.state =
        GpuBuffer::deviceLocal(ctx_, kStateBytes, kStorage | VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT);
    slot.count = GpuBuffer::deviceLocal(ctx_, kWord, kStorage);
    slot.status = GpuBuffer::deviceLocal(ctx_, kWord, kStorage);
    if (!slot.keys[0] || !slot.keys[1] || !slot.values[0] || !slot.values[1] || !slot.histogram ||
        !slot.totals || !slot.state || !slot.count || !slot.status)
      return false;
  }
  slots_ = std::move(next);
  capacity_ = capacity;
  return true;
}

RadixSort::Output RadixSort::output(uint32_t slot) const {
  if (slot >= kSlots || !capacity_) return {};
  const auto& s = slots_[slot];
  return {s.keys[0]->handle(), s.values[0]->handle(), s.count->handle(), s.status->handle()};
}

bool RadixSort::encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const {
  if (!cmd || slot >= kSlots || !capacity_ ||
      (input.keyBits != KeyBits::full32 && input.keyBits != KeyBits::low16))
    return false;
  const auto& limits = ctx_.vkbDevice().physical_device.properties.limits;
  const VkDeviceSize bytes = VkDeviceSize{capacity_} * kWord;
  const auto valid = [&](VkBuffer buffer, VkDeviceSize offset, VkDeviceSize total,
                         VkDeviceSize range) {
    if (!buffer || offset > total || range > total - offset || offset % kWord ||
        (limits.minStorageBufferOffsetAlignment && offset % limits.minStorageBufferOffsetAlignment))
      return false;
    for (const auto& s : slots_) {
      for (uint32_t i = 0; i < 2; ++i)
        if (buffer == s.keys[i]->handle() || buffer == s.values[i]->handle()) return false;
      if (buffer == s.count->handle() || buffer == s.status->handle() ||
          buffer == s.state->handle() || buffer == s.histogram->handle() ||
          buffer == s.totals->handle())
        return false;
    }
    return true;
  };
  if (!valid(input.keys, input.keysOffset, input.keysBytes, bytes) ||
      !valid(input.values, input.valuesOffset, input.valuesBytes, bytes) ||
      !valid(input.count, input.countOffset, input.countBytes, kWord))
    return false;
  const auto& s = slots_[slot];
  auto info = [](const std::unique_ptr<GpuBuffer>& buffer) {
    return VkDescriptorBufferInfo{buffer->handle(), 0, buffer->size()};
  };
  for (uint32_t set = 0; set < kSets; ++set) {
    const uint32_t in = set == 1 ? 1 : 0;
    const uint32_t out = in ^ 1;
    const VkDescriptorBufferInfo infos[kBindings] = {
        set == 0 ? VkDescriptorBufferInfo{input.keys, input.keysOffset, bytes} : info(s.keys[in]),
        set == 0 ? VkDescriptorBufferInfo{input.values, input.valuesOffset, bytes}
                 : info(s.values[in]),
        info(s.keys[out]),
        info(s.values[out]),
        {input.count, input.countOffset, kWord},
        info(s.histogram),
        info(s.totals),
        info(s.state),
        info(s.count),
        info(s.status)};
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
  memoryBarrier(cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT | VK_PIPELINE_STAGE_HOST_BIT,
                VK_ACCESS_MEMORY_WRITE_BIT | VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_HOST_WRITE_BIT,
                kCompute, VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
  PushConstants push{capacity_, 0, limits.maxComputeWorkGroupCount[0]};
  const auto bindSet = [&](uint32_t set) {
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, layout_, 0, 1, &sets_[slot][set],
                            0, nullptr);
  };
  // Rebind after each pipeline transition because MoltenVK/gfxstream can retain stale compute state
  // from a different layout.
  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_[kPrepare]);
  bindSet(0);
  vkCmdPushConstants(cmd, layout_, kShader, 0, sizeof(push), &push);
  vkCmdDispatch(cmd, 1, 1, 1);
  memoryBarrier(
      cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT, kCompute | VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_INDIRECT_COMMAND_READ_BIT);
  const uint32_t passes = (input.keyBits == KeyBits::low16 ? 16 : 32) / kDigitBits;
  for (uint32_t pass = 0; pass < passes; ++pass) {
    push.shift = pass * kDigitBits;
    const uint32_t set = pass == 0 ? 0 : (pass & 1 ? 1 : 2);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_[kHistogram]);
    bindSet(set);
    vkCmdPushConstants(cmd, layout_, kShader, 0, sizeof(push), &push);
    vkCmdDispatchIndirect(cmd, s.state->handle(), 0);
    memoryBarrier(cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT, kCompute,
                  VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_[kScan]);
    bindSet(set);
    vkCmdPushConstants(cmd, layout_, kShader, 0, sizeof(push), &push);
    const uint32_t scanX = std::min(kBuckets, push.maxGroupsX);
    vkCmdDispatch(cmd, scanX, (kBuckets + scanX - 1) / scanX, 1);
    memoryBarrier(cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT, kCompute,
                  VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_[kScatter]);
    bindSet(set);
    vkCmdPushConstants(cmd, layout_, kShader, 0, sizeof(push), &push);
    vkCmdDispatchIndirect(cmd, s.state->handle(), 0);
    memoryBarrier(cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT, kCompute,
                  VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT);
  }
  memoryBarrier(cmd, kCompute, VK_ACCESS_SHADER_WRITE_BIT,
                kCompute | VK_PIPELINE_STAGE_VERTEX_SHADER_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_TRANSFER_READ_BIT);
  return true;
}
}

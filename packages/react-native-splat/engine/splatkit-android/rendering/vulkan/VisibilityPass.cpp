#include "rendering/vulkan/VisibilityPass.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>
#include <vector>

#include "rendering/vulkan/VulkanHelpers.h"
#include "rendering/vulkan/VulkanShaderTypes.h"
#include "shaders/prepare_indirect_comp.h"
#include "shaders/visibility_comp.h"
#include "splatkit/Log.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {
namespace {

constexpr VkShaderStageFlags kComputeShader = VK_SHADER_STAGE_COMPUTE_BIT;
constexpr VkPipelineStageFlags kComputeStage = VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT;
constexpr VkSubgroupFeatureFlags kRequiredSubgroupOperations = VK_SUBGROUP_FEATURE_BASIC_BIT |
                                                               VK_SUBGROUP_FEATURE_ARITHMETIC_BIT |
                                                               VK_SUBGROUP_FEATURE_BALLOT_BIT;

// visibility.comp binds the camera uniform and seven storage buffers: splats, indices, depth keys,
// count, status, candidates and the candidate count. prepare_indirect.comp binds the count,
// the indirect draw arguments and the status.
constexpr uint32_t kVisibilityStorageBindings = 7;
constexpr uint32_t kVisibilityBindings = 1 + kVisibilityStorageBindings;
constexpr uint32_t kPrepareBindings = 3;
// The bits of the shader's keyMode push constant.
constexpr uint32_t kKeyLow16 = 1;
constexpr uint32_t kKeyDescending = 2;

struct PushConstants {
  uint32_t sourceCount;
  uint32_t capacity;
  float minPixelRadius;
  uint32_t dispatchGroupsX;
  uint32_t candidateCapacity;
  uint32_t mode;
  uint32_t rangeCount;
  uint32_t keyMode;
};
static_assert(sizeof(PushConstants) == 32, "must match the Constants block of visibility.comp");

// The number of candidates a pass reads: a prefix without a capacity reads every source.
uint32_t candidateBound(const VisibilityPass::Input& input) {
  return input.mode == VisibilityPass::CandidateMode::prefix && input.candidateCapacity == 0
             ? input.sourceCount
             : input.candidateCapacity;
}

static_assert(sizeof(CameraUniform) == 8384, "visibility camera layout must match splat.vert");
static_assert(sizeof(VkDrawIndirectCommand) == 16,
              "visibility indirect output must match native Vulkan draw arguments");

}  // namespace

VisibilityCapabilities VisibilityPass::queryCapabilities(const VulkanContext& ctx) {
  VisibilityCapabilities result;
  uint32_t queueFamilyCount = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice(), &queueFamilyCount, nullptr);
  std::vector<VkQueueFamilyProperties> queueFamilies(queueFamilyCount);
  vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice(), &queueFamilyCount,
                                           queueFamilies.data());
  VkPhysicalDeviceSubgroupProperties subgroup{
      VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES};
  VkPhysicalDeviceProperties2 properties{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
  properties.pNext = &subgroup;
  vkGetPhysicalDeviceProperties2(ctx.physicalDevice(), &properties);

  result.subgroupSize = subgroup.subgroupSize;
  result.supportedStages = subgroup.supportedStages;
  result.supportedOperations = subgroup.supportedOperations;
  result.maxComputeWorkGroupInvocations =
      properties.properties.limits.maxComputeWorkGroupInvocations;
  result.maxComputeWorkGroupSizeX = properties.properties.limits.maxComputeWorkGroupSize[0];
  result.maxComputeWorkGroupCountX = properties.properties.limits.maxComputeWorkGroupCount[0];
  result.maxComputeWorkGroupCountY = properties.properties.limits.maxComputeWorkGroupCount[1];
  result.maxStorageBufferRange = properties.properties.limits.maxStorageBufferRange;

  if (ctx.queueFamily() >= queueFamilies.size() ||
      (queueFamilies[ctx.queueFamily()].queueFlags & VK_QUEUE_COMPUTE_BIT) == 0) {
    result.reason = "selected queue family has no compute capability";
  } else if ((subgroup.supportedStages & kComputeShader) == 0) {
    result.reason = "subgroup operations are not supported in compute shaders";
  } else if ((subgroup.supportedOperations & kRequiredSubgroupOperations) !=
             kRequiredSubgroupOperations) {
    result.reason = "subgroup basic, arithmetic, or ballot operation is unavailable";
  } else if (subgroup.subgroupSize == 0) {
    result.reason = "device reported an invalid subgroup size";
  } else if (result.maxComputeWorkGroupInvocations < kWorkgroupSize ||
             result.maxComputeWorkGroupSizeX < kWorkgroupSize ||
             result.maxComputeWorkGroupCountX == 0 || result.maxComputeWorkGroupCountY == 0) {
    result.reason = "compute workgroup limits are below the visibility workgroup size";
  } else if (properties.properties.limits.maxPerStageDescriptorStorageBuffers <
                 kVisibilityStorageBindings ||
             properties.properties.limits.maxDescriptorSetStorageBuffers <
                 kVisibilityStorageBindings ||
             properties.properties.limits.maxPerStageResources < kVisibilityBindings ||
             properties.properties.limits.maxUniformBufferRange < sizeof(CameraUniform) ||
             result.maxStorageBufferRange < sizeof(GpuSplat)) {
    result.reason = "descriptor or buffer-range limits are below visibility requirements";
  } else {
    result.supported = true;
    result.reason = "subgroup arithmetic visibility is available";
  }
  return result;
}

splat::Result<std::unique_ptr<VisibilityPass>> VisibilityPass::create(const VulkanContext& ctx,
                                                                      float minPixelRadius) {
  if (!std::isfinite(minPixelRadius) || minPixelRadius < 0.0f) {
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "visibility: invalid minimum pixel radius"};
  }
  VisibilityCapabilities capabilities = queryCapabilities(ctx);
  if (!capabilities.supported) {
    LOGI("GPU visibility unavailable: %s", capabilities.reason.c_str());
    return splat::Error{splat::ErrorCode::gpuUnavailable, "visibility: " + capabilities.reason};
  }

  std::unique_ptr<VisibilityPass> pass(
      new VisibilityPass(ctx, std::move(capabilities), minPixelRadius));
  if (!pass->createDescriptors() || !pass->createPipelines()) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "visibility pipeline"};
  }
  return pass;
}

bool VisibilityPass::setMinPixelRadius(float radius) {
  if (!std::isfinite(radius) || radius < 0.0f) return false;
  minPixelRadius_ = radius;
  return true;
}

VisibilityPass::~VisibilityPass() {
  VkDevice device = ctx_.device();
  if (visibilityPipeline_) vkDestroyPipeline(device, visibilityPipeline_, nullptr);
  if (preparePipeline_) vkDestroyPipeline(device, preparePipeline_, nullptr);
  if (visibilityLayout_) vkDestroyPipelineLayout(device, visibilityLayout_, nullptr);
  if (prepareLayout_) vkDestroyPipelineLayout(device, prepareLayout_, nullptr);
  if (descriptorPool_) vkDestroyDescriptorPool(device, descriptorPool_, nullptr);
  if (visibilitySetLayout_) vkDestroyDescriptorSetLayout(device, visibilitySetLayout_, nullptr);
  if (prepareSetLayout_) vkDestroyDescriptorSetLayout(device, prepareSetLayout_, nullptr);
}

bool VisibilityPass::createDescriptors() {
  VkDevice device = ctx_.device();
  VkDescriptorSetLayoutBinding visibilityBindings[kVisibilityBindings]{};
  visibilityBindings[0] = {0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, kComputeShader, nullptr};
  for (uint32_t binding = 1; binding < kVisibilityBindings; ++binding) {
    visibilityBindings[binding] = {binding, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, kComputeShader,
                                   nullptr};
  }
  VkDescriptorSetLayoutCreateInfo visibilityInfo{
      VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  visibilityInfo.bindingCount = kVisibilityBindings;
  visibilityInfo.pBindings = visibilityBindings;
  if (vkCreateDescriptorSetLayout(device, &visibilityInfo, nullptr, &visibilitySetLayout_) !=
      VK_SUCCESS)
    return false;

  VkDescriptorSetLayoutBinding prepareBindings[kPrepareBindings]{};
  for (uint32_t binding = 0; binding < kPrepareBindings; ++binding) {
    prepareBindings[binding] = {binding, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, kComputeShader,
                                nullptr};
  }
  VkDescriptorSetLayoutCreateInfo prepareInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  prepareInfo.bindingCount = kPrepareBindings;
  prepareInfo.pBindings = prepareBindings;
  if (vkCreateDescriptorSetLayout(device, &prepareInfo, nullptr, &prepareSetLayout_) != VK_SUCCESS)
    return false;

  VkDescriptorPoolSize sizes[2]{};
  sizes[0] = {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, kSlots};
  sizes[1] = {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
              (kVisibilityStorageBindings + kPrepareBindings) * kSlots};
  VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  poolInfo.maxSets = 2 * kSlots;
  poolInfo.poolSizeCount = 2;
  poolInfo.pPoolSizes = sizes;
  if (vkCreateDescriptorPool(device, &poolInfo, nullptr, &descriptorPool_) != VK_SUCCESS)
    return false;

  std::array<VkDescriptorSetLayout, kSlots> visibilityLayouts{};
  std::array<VkDescriptorSetLayout, kSlots> prepareLayouts{};
  visibilityLayouts.fill(visibilitySetLayout_);
  prepareLayouts.fill(prepareSetLayout_);
  VkDescriptorSetAllocateInfo visibilityAlloc{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
  visibilityAlloc.descriptorPool = descriptorPool_;
  visibilityAlloc.descriptorSetCount = kSlots;
  visibilityAlloc.pSetLayouts = visibilityLayouts.data();
  if (vkAllocateDescriptorSets(device, &visibilityAlloc, visibilitySets_.data()) != VK_SUCCESS)
    return false;
  VkDescriptorSetAllocateInfo prepareAlloc{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
  prepareAlloc.descriptorPool = descriptorPool_;
  prepareAlloc.descriptorSetCount = kSlots;
  prepareAlloc.pSetLayouts = prepareLayouts.data();
  return vkAllocateDescriptorSets(device, &prepareAlloc, prepareSets_.data()) == VK_SUCCESS;
}

bool VisibilityPass::createPipelines() {
  VkDevice device = ctx_.device();
  const VkPushConstantRange push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(PushConstants)};
  VkPipelineLayoutCreateInfo visibilityLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  visibilityLayoutInfo.setLayoutCount = 1;
  visibilityLayoutInfo.pSetLayouts = &visibilitySetLayout_;
  visibilityLayoutInfo.pushConstantRangeCount = 1;
  visibilityLayoutInfo.pPushConstantRanges = &push;
  if (vkCreatePipelineLayout(device, &visibilityLayoutInfo, nullptr, &visibilityLayout_) !=
      VK_SUCCESS)
    return false;
  VkPipelineLayoutCreateInfo prepareLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  prepareLayoutInfo.setLayoutCount = 1;
  prepareLayoutInfo.pSetLayouts = &prepareSetLayout_;
  if (vkCreatePipelineLayout(device, &prepareLayoutInfo, nullptr, &prepareLayout_) != VK_SUCCESS)
    return false;

  const ShaderModule visibilityModule(device, shaders::visibility_comp,
                                      shaders::visibility_comp_size);
  const ShaderModule prepareModule(device, shaders::prepare_indirect_comp,
                                   shaders::prepare_indirect_comp_size);
  if (!visibilityModule || !prepareModule) return false;
  VkPipelineShaderStageCreateInfo visibilityStage{
      VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
  visibilityStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  visibilityStage.module = visibilityModule.get();
  visibilityStage.pName = "main";
  VkComputePipelineCreateInfo visibilityInfo{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
  visibilityInfo.stage = visibilityStage;
  visibilityInfo.layout = visibilityLayout_;
  const VkResult visibilityResult = vkCreateComputePipelines(
      device, VK_NULL_HANDLE, 1, &visibilityInfo, nullptr, &visibilityPipeline_);

  VkPipelineShaderStageCreateInfo prepareStage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
  prepareStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  prepareStage.module = prepareModule.get();
  prepareStage.pName = "main";
  VkComputePipelineCreateInfo prepareInfo{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
  prepareInfo.stage = prepareStage;
  prepareInfo.layout = prepareLayout_;
  const VkResult prepareResult =
      vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &prepareInfo, nullptr, &preparePipeline_);
  return visibilityResult == VK_SUCCESS && prepareResult == VK_SUCCESS;
}

bool VisibilityPass::reserve(uint32_t capacity) {
  if (capacity == 0 || capacity > kMaxCapacity) return false;
  const VkDeviceSize maxRange = capabilities_.maxStorageBufferRange;
  // Output storage is independent of the resident source descriptor range.
  if (capacity > maxRange / sizeof(uint32_t)) {
    LOGE("visibility capacity %u exceeds storage buffer limits", capacity);
    return false;
  }
  const VkDeviceSize indicesBytes = VkDeviceSize{capacity} * sizeof(uint32_t);
  if (capacity == capacity_) return true;
  std::unique_ptr<GpuBuffer> dummy;
  if (!dummy_) {
    const uint32_t zeros[4]{};
    dummy = GpuBuffer::deviceLocal(ctx_, sizeof(zeros), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
    if (!dummy || !dummy->upload(zeros, sizeof(zeros))) return false;
  }

  std::array<std::unique_ptr<GpuBuffer>, kSlots> indices;
  std::array<std::unique_ptr<GpuBuffer>, kSlots> depthKeys;
  std::array<std::unique_ptr<GpuBuffer>, kSlots> counts;
  std::array<std::unique_ptr<GpuBuffer>, kSlots> indirect;
  std::array<std::unique_ptr<GpuBuffer>, kSlots> status;
  for (uint32_t slot = 0; slot < kSlots; ++slot) {
    indices[slot] = GpuBuffer::deviceLocal(
        ctx_, indicesBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    depthKeys[slot] = GpuBuffer::deviceLocal(
        ctx_, indicesBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    counts[slot] = GpuBuffer::deviceLocal(
        ctx_, sizeof(uint32_t),
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    indirect[slot] = GpuBuffer::deviceLocal(ctx_, sizeof(VkDrawIndirectCommand),
                                            VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
                                                VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT |
                                                VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    status[slot] = GpuBuffer::deviceLocal(
        ctx_, sizeof(uint32_t),
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    if (!indices[slot] || !depthKeys[slot] || !counts[slot] || !indirect[slot] || !status[slot]) {
      LOGE("visibility buffers for %u splats failed", capacity);
      return false;
    }
  }
  if (dummy) dummy_ = std::move(dummy);
  indices_ = std::move(indices);
  depthKeys_ = std::move(depthKeys);
  counts_ = std::move(counts);
  indirect_ = std::move(indirect);
  status_ = std::move(status);
  capacity_ = capacity;
  return true;
}

VisibilityPass::Output VisibilityPass::output(uint32_t slot) const {
  if (slot >= kSlots || capacity_ == 0) return {};
  return {indices_[slot]->handle(), depthKeys_[slot]->handle(), counts_[slot]->handle(),
          indirect_[slot]->handle(), status_[slot]->handle()};
}

bool VisibilityPass::updateDescriptors(uint32_t slot, const Input& input) const {
  const Output out = output(slot);
  if (!input.camera || !input.splats || !out.indices || !out.depthKeys || !out.count ||
      !out.indirect || !out.status)
    return false;
  const VkPhysicalDeviceProperties& properties = ctx_.vkbDevice().physical_device.properties;
  const VkDeviceSize uniformAlignment = properties.limits.minUniformBufferOffsetAlignment;
  const VkDeviceSize storageAlignment = properties.limits.minStorageBufferOffsetAlignment;
  if ((uniformAlignment != 0 && input.cameraOffset % uniformAlignment != 0) ||
      (storageAlignment != 0 && input.splatsOffset % storageAlignment != 0) ||
      sizeof(CameraUniform) > properties.limits.maxUniformBufferRange ||
      input.cameraOffset > std::numeric_limits<VkDeviceSize>::max() - sizeof(CameraUniform))
    return false;
  const VkDeviceSize sourceBytes = VkDeviceSize{std::max(input.sourceCount, 1u)} * sizeof(GpuSplat);
  if (input.splatsOffset > std::numeric_limits<VkDeviceSize>::max() - sourceBytes ||
      sourceBytes > capabilities_.maxStorageBufferRange)
    return false;
  auto validRange = [](VkDeviceSize offset, VkDeviceSize bytes, VkDeviceSize total) {
    return offset <= total && bytes <= total - offset;
  };
  if (!validRange(input.cameraOffset, sizeof(CameraUniform), input.cameraBytes) ||
      !validRange(input.splatsOffset, sourceBytes, input.splatsBytes))
    return false;
  const uint32_t bound = candidateBound(input);
  VkDescriptorBufferInfo candidateInfo{dummy_->handle(), 0, dummy_->size()};
  VkDescriptorBufferInfo candidateCountInfo{dummy_->handle(), 0, sizeof(uint32_t)};
  if (input.mode != CandidateMode::prefix) {
    const VkDeviceSize bytes = input.mode == CandidateMode::indices
                                   ? VkDeviceSize{std::max(bound, 1u)} * sizeof(uint32_t)
                                   : VkDeviceSize{std::max(input.rangeCount, 1u)} * sizeof(Range);
    if (!input.candidates || bytes > capabilities_.maxStorageBufferRange ||
        (storageAlignment && input.candidatesOffset % storageAlignment != 0) ||
        !validRange(input.candidatesOffset, bytes, input.candidatesBytes))
      return false;
    candidateInfo = {input.candidates, input.candidatesOffset, bytes};
  }
  if (input.mode == CandidateMode::indices) {
    if (!input.candidateCount ||
        (storageAlignment && input.candidateCountOffset % storageAlignment != 0) ||
        !validRange(input.candidateCountOffset, sizeof(uint32_t), input.candidateCountBytes))
      return false;
    candidateCountInfo = {input.candidateCount, input.candidateCountOffset, sizeof(uint32_t)};
  }
  const VkDescriptorBufferInfo camera{input.camera, input.cameraOffset, sizeof(CameraUniform)};
  const VkDescriptorBufferInfo splats{input.splats, input.splatsOffset, sourceBytes};
  const VkDescriptorBufferInfo indices{out.indices, 0, VK_WHOLE_SIZE};
  const VkDescriptorBufferInfo depthKeys{out.depthKeys, 0, VK_WHOLE_SIZE};
  const VkDescriptorBufferInfo count{out.count, 0, sizeof(uint32_t)};
  const VkDescriptorBufferInfo indirect{out.indirect, 0, sizeof(VkDrawIndirectCommand)};
  const VkDescriptorBufferInfo status{out.status, 0, sizeof(uint32_t)};
  const VkDescriptorBufferInfo visibilityInfos[kVisibilityBindings] = {
      camera, splats, indices, depthKeys, count, status, candidateInfo, candidateCountInfo};
  VkWriteDescriptorSet writes[kVisibilityBindings]{};
  for (uint32_t binding = 0; binding < kVisibilityBindings; ++binding) {
    writes[binding] = {
        VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,
        nullptr,
        visibilitySets_[slot],
        binding,
        0,
        1,
        binding == 0 ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
        nullptr,
        &visibilityInfos[binding],
        nullptr};
  }
  vkUpdateDescriptorSets(ctx_.device(), kVisibilityBindings, writes, 0, nullptr);

  const VkDescriptorBufferInfo prepareInfos[kPrepareBindings] = {count, indirect, status};
  VkWriteDescriptorSet prepareWrites[kPrepareBindings]{};
  for (uint32_t binding = 0; binding < kPrepareBindings; ++binding) {
    prepareWrites[binding] = {
        VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, prepareSets_[slot],     binding, 0, 1,
        VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,      nullptr, &prepareInfos[binding], nullptr};
  }
  vkUpdateDescriptorSets(ctx_.device(), kPrepareBindings, prepareWrites, 0, nullptr);
  return true;
}

void VisibilityPass::barrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage,
                             VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                             VkAccessFlags dstAccess, const Output& out) {
  VkBufferMemoryBarrier barriers[5]{};
  VkBuffer buffers[5] = {out.indices, out.depthKeys, out.count, out.indirect, out.status};
  const VkDeviceSize sizes[5] = {VK_WHOLE_SIZE, VK_WHOLE_SIZE, sizeof(uint32_t),
                                 sizeof(VkDrawIndirectCommand), sizeof(uint32_t)};
  for (uint32_t i = 0; i < 5; ++i) {
    barriers[i] = {VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
                   nullptr,
                   srcAccess,
                   dstAccess,
                   VK_QUEUE_FAMILY_IGNORED,
                   VK_QUEUE_FAMILY_IGNORED,
                   buffers[i],
                   0,
                   sizes[i]};
  }
  vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 0, nullptr, 5, barriers, 0, nullptr);
}

bool VisibilityPass::encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const {
  const uint32_t bound = candidateBound(input);
  if (cmd == VK_NULL_HANDLE || slot >= kSlots || capacity_ == 0 ||
      static_cast<uint32_t>(input.mode) > static_cast<uint32_t>(CandidateMode::ranges) ||
      static_cast<uint32_t>(input.keyBits) > static_cast<uint32_t>(KeyBits::low16) ||
      static_cast<uint32_t>(input.keyOrder) > static_cast<uint32_t>(KeyOrder::descending) ||
      (input.mode == CandidateMode::prefix && bound > input.sourceCount) ||
      (input.mode == CandidateMode::ranges &&
       ((bound == 0) != (input.rangeCount == 0) || input.rangeCount > bound ||
        bound > input.sourceCount)))
    return false;
  const uint64_t workgroups = (static_cast<uint64_t>(bound) + kWorkgroupSize - 1) / kWorkgroupSize;
  const uint64_t maxWorkgroups = static_cast<uint64_t>(capabilities_.maxComputeWorkGroupCountX) *
                                 capabilities_.maxComputeWorkGroupCountY;
  if (workgroups > maxWorkgroups || capabilities_.maxComputeWorkGroupCountX == 0) return false;
  const uint32_t groupsX = static_cast<uint32_t>(std::max<uint64_t>(
      1, std::min<uint64_t>(workgroups, capabilities_.maxComputeWorkGroupCountX)));
  const uint32_t groupsY =
      workgroups == 0 ? 1u : static_cast<uint32_t>((workgroups + groupsX - 1) / groupsX);
  if (!updateDescriptors(slot, input)) return false;
  const Output out = output(slot);
  // Slot reuse requires completion; this also orders already-recorded consumers and uploads.
  VkMemoryBarrier inputs{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
  inputs.srcAccessMask =
      VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_MEMORY_WRITE_BIT | VK_ACCESS_HOST_WRITE_BIT;
  inputs.dstAccessMask =
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_UNIFORM_READ_BIT | VK_ACCESS_TRANSFER_WRITE_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT | VK_PIPELINE_STAGE_HOST_BIT,
                       kComputeStage | VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 1, &inputs, 0, nullptr, 0,
                       nullptr);
  vkCmdFillBuffer(cmd, out.count, 0, sizeof(uint32_t), 0);
  vkCmdFillBuffer(cmd, out.status, 0, sizeof(uint32_t), 0);
  vkCmdFillBuffer(cmd, out.indirect, 0, sizeof(VkDrawIndirectCommand), 0);
  barrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, kComputeStage, VK_ACCESS_TRANSFER_WRITE_BIT,
          VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, out);

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, visibilityPipeline_);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, visibilityLayout_, 0, 1,
                          &visibilitySets_[slot], 0, nullptr);
  const PushConstants push{input.sourceCount,
                           capacity_,
                           minPixelRadius_,
                           groupsX,
                           bound,
                           static_cast<uint32_t>(input.mode),
                           input.rangeCount,
                           (input.keyBits == KeyBits::low16 ? kKeyLow16 : 0u) |
                               (input.keyOrder == KeyOrder::descending ? kKeyDescending : 0u)};
  vkCmdPushConstants(cmd, visibilityLayout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(push), &push);
  vkCmdDispatch(cmd, groupsX, groupsY, 1);
  barrier(cmd, kComputeStage, kComputeStage, VK_ACCESS_SHADER_WRITE_BIT,
          VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, out);

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preparePipeline_);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, prepareLayout_, 0, 1,
                          &prepareSets_[slot], 0, nullptr);
  vkCmdDispatch(cmd, 1, 1, 1);

  VkBufferMemoryBarrier consumer[5]{};
  consumer[0] = {VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
                 nullptr,
                 VK_ACCESS_SHADER_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_TRANSFER_READ_BIT,
                 VK_QUEUE_FAMILY_IGNORED,
                 VK_QUEUE_FAMILY_IGNORED,
                 out.indices,
                 0,
                 VK_WHOLE_SIZE};
  consumer[1] = consumer[0];
  consumer[1].buffer = out.depthKeys;
  consumer[4] = {VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
                 nullptr,
                 VK_ACCESS_SHADER_WRITE_BIT,
                 VK_ACCESS_INDIRECT_COMMAND_READ_BIT | VK_ACCESS_TRANSFER_READ_BIT,
                 VK_QUEUE_FAMILY_IGNORED,
                 VK_QUEUE_FAMILY_IGNORED,
                 out.indirect,
                 0,
                 sizeof(VkDrawIndirectCommand)};
  // Publish compacted index/key/count streams to the subsequent GPU radix pass.
  consumer[2] = {
      VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
      nullptr,
      VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_WRITE_BIT,
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_TRANSFER_READ_BIT,
      VK_QUEUE_FAMILY_IGNORED,
      VK_QUEUE_FAMILY_IGNORED,
      out.count,
      0,
      sizeof(uint32_t)};
  consumer[3] = consumer[2];
  consumer[3].buffer = out.status;
  // Empty input leaves count/status written by transfer rather than compute.
  vkCmdPipelineBarrier(cmd, kComputeStage | VK_PIPELINE_STAGE_TRANSFER_BIT,
                       VK_PIPELINE_STAGE_VERTEX_SHADER_BIT | kComputeStage |
                           VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
                       0, 0, nullptr, 5, consumer, 0, nullptr);
  return true;
}

}  // namespace splatkit

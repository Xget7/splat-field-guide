#include "rendering/vulkan/cull/VulkanVisibilityPass.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <utility>
#include <vector>

#include "rendering/vulkan/device/VulkanShaderModule.h"
#include "rendering/vulkan/layout/VulkanShaderTypes.h"
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

// visibility.comp binds the camera uniform and nine storage buffers: splats, values, depth keys,
// count, status, candidates, the candidate count, the harmonics and the projected records.
// prepare_indirect.comp binds the count, the indirect draw arguments and the status.
constexpr uint32_t kVisibilityStorageBindings = 9;
constexpr uint32_t kVisibilityBindings = 1 + kVisibilityStorageBindings;
constexpr uint32_t kPrepareBindings = 3;
// Each frame slot owns one visibility set and one prepare set.
constexpr uint32_t kSetFamilies = 2;
// The descriptor pool holds uniform buffers and storage buffers.
constexpr uint32_t kPoolSizeCount = 2;
// The bits of the shader's keyMode push constant.
constexpr uint32_t kKeyLow16 = 1;
constexpr uint32_t kKeyDescending = 2;

struct PushConstants {
  uint32_t sourceCount;
  uint32_t capacity;
  uint32_t dispatchGroupsX;
  uint32_t candidateCapacity;
  uint32_t mode;
  uint32_t rangeCount;
  uint32_t keyMode;
};
static_assert(sizeof(PushConstants) == 28, "must match the Constants block of visibility.comp");

// The number of candidates a pass reads: a prefix without a capacity reads every source.
uint32_t candidateBound(const VulkanVisibilityPass::Input& input) {
  return input.mode == VulkanVisibilityPass::CandidateMode::prefix && input.candidateCapacity == 0
             ? input.sourceCount
             : input.candidateCapacity;
}

bool validRange(VkDeviceSize offset, VkDeviceSize bytes, VkDeviceSize total) {
  return offset <= total && bytes <= total - offset;
}

bool isAligned(VkDeviceSize offset, VkDeviceSize alignment) {
  return alignment == 0 || offset % alignment == 0;
}

bool hasAllHandles(const VulkanVisibilityPass::Output& out) {
  return out.values && out.projected && out.depthKeys && out.count && out.indirect && out.status;
}

VkDeviceSize sourceBytes(const VulkanVisibilityPass::Input& input) {
  return VkDeviceSize{std::max(input.sourceCount, 1u)} * sizeof(GpuSplat);
}

bool acceptsCamera(const VulkanVisibilityPass::Input& input, const VkPhysicalDeviceLimits& limits) {
  return isAligned(input.cameraOffset, limits.minUniformBufferOffsetAlignment) &&
         sizeof(CameraUniform) <= limits.maxUniformBufferRange &&
         input.cameraOffset <= std::numeric_limits<VkDeviceSize>::max() - sizeof(CameraUniform) &&
         validRange(input.cameraOffset, sizeof(CameraUniform), input.cameraBytes);
}

bool acceptsSplats(const VulkanVisibilityPass::Input& input, VkDeviceSize storageAlignment,
                   VkDeviceSize maxStorageRange) {
  const VkDeviceSize bytes = sourceBytes(input);
  return isAligned(input.splatsOffset, storageAlignment) &&
         input.splatsOffset <= std::numeric_limits<VkDeviceSize>::max() - bytes &&
         bytes <= maxStorageRange && validRange(input.splatsOffset, bytes, input.splatsBytes);
}

// Leaves `info` on the dummy range at degree 0, which never reads the harmonics.
bool describeSh(const VulkanVisibilityPass::Input& input, VkDeviceSize storageAlignment,
                VkDeviceSize maxStorageRange, VkDescriptorBufferInfo& info) {
  if (input.shDegree == 0) return true;
  const VkDeviceSize bytes =
      VkDeviceSize{std::max(input.sourceCount, 1u)} * shStride(input.shDegree) * sizeof(uint32_t);
  if (!input.sh || bytes > maxStorageRange || !isAligned(input.shOffset, storageAlignment) ||
      !validRange(input.shOffset, bytes, input.shBytes))
    return false;
  info = {input.sh, input.shOffset, bytes};
  return true;
}

VkDeviceSize candidateBytes(const VulkanVisibilityPass::Input& input) {
  if (input.mode == VulkanVisibilityPass::CandidateMode::indices)
    return VkDeviceSize{std::max(candidateBound(input), 1u)} * sizeof(uint32_t);
  return VkDeviceSize{std::max(input.rangeCount, 1u)} * sizeof(VulkanVisibilityPass::Range);
}

// Leaves `info` on the dummy range for prefix mode, which has no candidate list.
bool describeCandidates(const VulkanVisibilityPass::Input& input, VkDeviceSize storageAlignment,
                        VkDeviceSize maxStorageRange, VkDescriptorBufferInfo& info) {
  if (input.mode == VulkanVisibilityPass::CandidateMode::prefix) return true;
  const VkDeviceSize bytes = candidateBytes(input);
  if (!input.candidates || bytes > maxStorageRange ||
      !isAligned(input.candidatesOffset, storageAlignment) ||
      !validRange(input.candidatesOffset, bytes, input.candidatesBytes))
    return false;
  info = {input.candidates, input.candidatesOffset, bytes};
  return true;
}

// Only indices mode reads a GPU candidate count.
bool describeCandidateCount(const VulkanVisibilityPass::Input& input, VkDeviceSize storageAlignment,
                            VkDescriptorBufferInfo& info) {
  if (input.mode != VulkanVisibilityPass::CandidateMode::indices) return true;
  if (!input.candidateCount || !isAligned(input.candidateCountOffset, storageAlignment) ||
      !validRange(input.candidateCountOffset, sizeof(uint32_t), input.candidateCountBytes))
    return false;
  info = {input.candidateCount, input.candidateCountOffset, sizeof(uint32_t)};
  return true;
}

// Binding 0 takes `firstType`, every other binding is a storage buffer.
template <size_t N>
void writeBindings(VkDevice device, VkDescriptorSet set,
                   const std::array<VkDescriptorBufferInfo, N>& infos, VkDescriptorType firstType) {
  std::array<VkWriteDescriptorSet, N> writes{};
  for (uint32_t binding = 0; binding < N; ++binding) {
    writes[binding] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,
                       nullptr,
                       set,
                       binding,
                       0,
                       1,
                       binding == 0 ? firstType : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
                       nullptr,
                       &infos[binding],
                       nullptr};
  }
  vkUpdateDescriptorSets(device, N, writes.data(), 0, nullptr);
}

static_assert(sizeof(VkDrawIndirectCommand) == 16,
              "visibility indirect output must match native Vulkan draw arguments");

}  // namespace

VulkanVisibilityCapabilities VulkanVisibilityPass::queryCapabilities(const VulkanContext& ctx) {
  VulkanVisibilityCapabilities result;
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

std::shared_ptr<const VulkanVisibilityPass::Pipelines> VulkanVisibilityPass::Pipelines::compile(
    const VulkanContext& ctx) {
  if (!queryCapabilities(ctx).supported) return nullptr;
  VkDevice device = ctx.device();
  auto pipelines = std::make_shared<Pipelines>(device);
  VkDescriptorSetLayoutBinding visibilityBindings[kVisibilityBindings]{};
  visibilityBindings[0] = {0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, kComputeShader, nullptr};
  for (uint32_t binding = 1; binding < kVisibilityBindings; ++binding) {
    visibilityBindings[binding] = {binding, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, kComputeShader,
                                   nullptr};
  }
  VkDescriptorSetLayoutCreateInfo visibilitySetInfo{
      VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  visibilitySetInfo.bindingCount = kVisibilityBindings;
  visibilitySetInfo.pBindings = visibilityBindings;
  if (vkCreateDescriptorSetLayout(device, &visibilitySetInfo, nullptr, &pipelines->visibilitySet) !=
      VK_SUCCESS)
    return nullptr;
  VkDescriptorSetLayoutBinding prepareBindings[kPrepareBindings]{};
  for (uint32_t binding = 0; binding < kPrepareBindings; ++binding) {
    prepareBindings[binding] = {binding, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, kComputeShader,
                                nullptr};
  }
  VkDescriptorSetLayoutCreateInfo prepareSetInfo{
      VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  prepareSetInfo.bindingCount = kPrepareBindings;
  prepareSetInfo.pBindings = prepareBindings;
  if (vkCreateDescriptorSetLayout(device, &prepareSetInfo, nullptr, &pipelines->prepareSet) !=
      VK_SUCCESS)
    return nullptr;

  const VkPushConstantRange push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(PushConstants)};
  VkPipelineLayoutCreateInfo visibilityLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  visibilityLayoutInfo.setLayoutCount = 1;
  visibilityLayoutInfo.pSetLayouts = &pipelines->visibilitySet;
  visibilityLayoutInfo.pushConstantRangeCount = 1;
  visibilityLayoutInfo.pPushConstantRanges = &push;
  if (vkCreatePipelineLayout(device, &visibilityLayoutInfo, nullptr,
                             &pipelines->visibilityLayout) != VK_SUCCESS)
    return nullptr;
  VkPipelineLayoutCreateInfo prepareLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  prepareLayoutInfo.setLayoutCount = 1;
  prepareLayoutInfo.pSetLayouts = &pipelines->prepareSet;
  if (vkCreatePipelineLayout(device, &prepareLayoutInfo, nullptr, &pipelines->prepareLayout) !=
      VK_SUCCESS)
    return nullptr;

  const VulkanShaderModule visibilityModule(device, shaders::visibility_comp,
                                            shaders::visibility_comp_size);
  const VulkanShaderModule prepareModule(device, shaders::prepare_indirect_comp,
                                         shaders::prepare_indirect_comp_size);
  if (!visibilityModule || !prepareModule) return nullptr;
  VkPipelineShaderStageCreateInfo visibilityStage{
      VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
  visibilityStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  visibilityStage.module = visibilityModule.get();
  visibilityStage.pName = "main";
  struct {
    uint32_t shDegree = 0;
    float quadMinAlpha = kQuadMinAlpha;
  } constants;
  const std::array<VkSpecializationMapEntry, 2> entries{{
      {kShDegreeConstant, offsetof(decltype(constants), shDegree), sizeof(uint32_t)},
      {kQuadMinAlphaConstant, offsetof(decltype(constants), quadMinAlpha), sizeof(float)},
  }};
  const VkSpecializationInfo specialization{static_cast<uint32_t>(entries.size()), entries.data(),
                                            sizeof(constants), &constants};
  visibilityStage.pSpecializationInfo = &specialization;
  VkComputePipelineCreateInfo visibilityInfo{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
  visibilityInfo.stage = visibilityStage;
  visibilityInfo.layout = pipelines->visibilityLayout;
  bool visibilityCreated = true;
  for (int degree = 0; degree <= kMaxShDegree && visibilityCreated; ++degree) {
    constants.shDegree = static_cast<uint32_t>(degree);
    visibilityCreated =
        vkCreateComputePipelines(device, ctx.pipelineCache(), 1, &visibilityInfo, nullptr,
                                 &pipelines->visibility[static_cast<size_t>(degree)]) == VK_SUCCESS;
  }

  VkPipelineShaderStageCreateInfo prepareStage{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
  prepareStage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  prepareStage.module = prepareModule.get();
  prepareStage.pName = "main";
  VkComputePipelineCreateInfo prepareInfo{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
  prepareInfo.stage = prepareStage;
  prepareInfo.layout = pipelines->prepareLayout;
  const VkResult prepareResult = vkCreateComputePipelines(
      device, ctx.pipelineCache(), 1, &prepareInfo, nullptr, &pipelines->prepare);
  if (!visibilityCreated || prepareResult != VK_SUCCESS) return nullptr;
  return pipelines;
}

VulkanVisibilityPass::Pipelines::~Pipelines() {
  for (VkPipeline pipeline : visibility) {
    if (pipeline) vkDestroyPipeline(device, pipeline, nullptr);
  }
  if (prepare) vkDestroyPipeline(device, prepare, nullptr);
  if (visibilityLayout) vkDestroyPipelineLayout(device, visibilityLayout, nullptr);
  if (prepareLayout) vkDestroyPipelineLayout(device, prepareLayout, nullptr);
  if (visibilitySet) vkDestroyDescriptorSetLayout(device, visibilitySet, nullptr);
  if (prepareSet) vkDestroyDescriptorSetLayout(device, prepareSet, nullptr);
}

splat::Result<std::unique_ptr<VulkanVisibilityPass>> VulkanVisibilityPass::create(
    const VulkanContext& ctx) {
  return create(ctx, Pipelines::compile(ctx));
}

splat::Result<std::unique_ptr<VulkanVisibilityPass>> VulkanVisibilityPass::create(
    const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines) {
  VulkanVisibilityCapabilities capabilities = queryCapabilities(ctx);
  if (!capabilities.supported) {
    LOGI("GPU visibility unavailable: %s", capabilities.reason.c_str());
    return splat::Error{splat::ErrorCode::gpuUnavailable, "visibility: " + capabilities.reason};
  }
  if (!pipelines) return splat::Error{splat::ErrorCode::gpuUnavailable, "visibility pipeline"};
  std::unique_ptr<VulkanVisibilityPass> pass(
      new VulkanVisibilityPass(ctx, std::move(capabilities), std::move(pipelines)));
  if (!pass->createDescriptors()) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "visibility descriptors"};
  }
  return pass;
}

VulkanVisibilityPass::~VulkanVisibilityPass() {
  if (descriptorPool_) vkDestroyDescriptorPool(ctx_.device(), descriptorPool_, nullptr);
}

bool VulkanVisibilityPass::createDescriptors() {
  VkDevice device = ctx_.device();
  VkDescriptorPoolSize sizes[kPoolSizeCount]{};
  sizes[0] = {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, kFramesInFlight};
  sizes[1] = {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
              (kVisibilityStorageBindings + kPrepareBindings) * kFramesInFlight};
  VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  poolInfo.maxSets = kSetFamilies * kFramesInFlight;
  poolInfo.poolSizeCount = kPoolSizeCount;
  poolInfo.pPoolSizes = sizes;
  if (vkCreateDescriptorPool(device, &poolInfo, nullptr, &descriptorPool_) != VK_SUCCESS)
    return false;

  std::array<VkDescriptorSetLayout, kFramesInFlight> visibilityLayouts{};
  std::array<VkDescriptorSetLayout, kFramesInFlight> prepareLayouts{};
  visibilityLayouts.fill(pipelines_->visibilitySet);
  prepareLayouts.fill(pipelines_->prepareSet);
  VkDescriptorSetAllocateInfo visibilityAlloc{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
  visibilityAlloc.descriptorPool = descriptorPool_;
  visibilityAlloc.descriptorSetCount = kFramesInFlight;
  visibilityAlloc.pSetLayouts = visibilityLayouts.data();
  if (vkAllocateDescriptorSets(device, &visibilityAlloc, visibilitySets_.data()) != VK_SUCCESS)
    return false;
  VkDescriptorSetAllocateInfo prepareAlloc{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
  prepareAlloc.descriptorPool = descriptorPool_;
  prepareAlloc.descriptorSetCount = kFramesInFlight;
  prepareAlloc.pSetLayouts = prepareLayouts.data();
  return vkAllocateDescriptorSets(device, &prepareAlloc, prepareSets_.data()) == VK_SUCCESS;
}

bool VulkanVisibilityPass::reserve(uint32_t capacity) {
  if (capacity == 0 || capacity > kMaxCapacity) return false;
  const VkDeviceSize maxRange = capabilities_.maxStorageBufferRange;
  // Output storage is independent of the resident source descriptor range.
  if (capacity > maxRange / sizeof(ProjectedSplat)) {
    LOGE("visibility capacity %u exceeds storage buffer limits", capacity);
    return false;
  }
  const VkDeviceSize wordBytes = VkDeviceSize{capacity} * sizeof(uint32_t);
  const VkDeviceSize projectedBytes = VkDeviceSize{capacity} * sizeof(ProjectedSplat);
  if (capacity == capacity_) return true;
  std::unique_ptr<VulkanBuffer> dummy;
  if (!dummy_) {
    const uint32_t zeros[4]{};
    dummy = VulkanBuffer::deviceLocal(ctx_, sizeof(zeros), VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
    if (!dummy || !dummy->upload(zeros, sizeof(zeros))) return false;
  }

  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> values;
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> projected;
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> depthKeys;
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> counts;
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> indirect;
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> status;
  for (uint32_t slot = 0; slot < kFramesInFlight; ++slot) {
    values[slot] = VulkanBuffer::deviceLocal(
        ctx_, wordBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    projected[slot] = VulkanBuffer::deviceLocal(
        ctx_, projectedBytes,
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    depthKeys[slot] = VulkanBuffer::deviceLocal(
        ctx_, wordBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    counts[slot] = VulkanBuffer::deviceLocal(
        ctx_, sizeof(uint32_t),
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    indirect[slot] = VulkanBuffer::deviceLocal(ctx_, sizeof(VkDrawIndirectCommand),
                                               VK_BUFFER_USAGE_STORAGE_BUFFER_BIT |
                                                   VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT |
                                                   VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    status[slot] = VulkanBuffer::deviceLocal(
        ctx_, sizeof(uint32_t),
        VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    if (!values[slot] || !projected[slot] || !depthKeys[slot] || !counts[slot] || !indirect[slot] ||
        !status[slot]) {
      LOGE("visibility buffers for %u splats failed", capacity);
      return false;
    }
  }
  if (dummy) dummy_ = std::move(dummy);
  values_ = std::move(values);
  projected_ = std::move(projected);
  depthKeys_ = std::move(depthKeys);
  counts_ = std::move(counts);
  indirect_ = std::move(indirect);
  status_ = std::move(status);
  capacity_ = capacity;
  return true;
}

VulkanVisibilityPass::Output VulkanVisibilityPass::output(uint32_t slot) const {
  if (slot >= kFramesInFlight || capacity_ == 0) return {};
  return {values_[slot]->handle(), projected_[slot]->handle(), depthKeys_[slot]->handle(),
          counts_[slot]->handle(), indirect_[slot]->handle(),  status_[slot]->handle()};
}

bool VulkanVisibilityPass::updateDescriptors(uint32_t slot, const Input& input) const {
  const Output out = output(slot);
  if (!input.camera || !input.splats || !hasAllHandles(out)) return false;
  const VkPhysicalDeviceLimits& limits = ctx_.vkbDevice().physical_device.properties.limits;
  const VkDeviceSize storageAlignment = limits.minStorageBufferOffsetAlignment;
  const VkDeviceSize maxStorageRange = capabilities_.maxStorageBufferRange;
  VkDescriptorBufferInfo candidateInfo{dummy_->handle(), 0, dummy_->size()};
  VkDescriptorBufferInfo candidateCountInfo{dummy_->handle(), 0, sizeof(uint32_t)};
  VkDescriptorBufferInfo shInfo{dummy_->handle(), 0, dummy_->size()};
  if (!acceptsCamera(input, limits) || !acceptsSplats(input, storageAlignment, maxStorageRange) ||
      !describeSh(input, storageAlignment, maxStorageRange, shInfo) ||
      !describeCandidates(input, storageAlignment, maxStorageRange, candidateInfo) ||
      !describeCandidateCount(input, storageAlignment, candidateCountInfo))
    return false;
  const VkDescriptorBufferInfo camera{input.camera, input.cameraOffset, sizeof(CameraUniform)};
  const VkDescriptorBufferInfo splats{input.splats, input.splatsOffset, sourceBytes(input)};
  const VkDescriptorBufferInfo values{out.values, 0, VK_WHOLE_SIZE};
  const VkDescriptorBufferInfo projected{out.projected, 0, VK_WHOLE_SIZE};
  const VkDescriptorBufferInfo depthKeys{out.depthKeys, 0, VK_WHOLE_SIZE};
  const VkDescriptorBufferInfo count{out.count, 0, sizeof(uint32_t)};
  const VkDescriptorBufferInfo indirect{out.indirect, 0, sizeof(VkDrawIndirectCommand)};
  const VkDescriptorBufferInfo status{out.status, 0, sizeof(uint32_t)};
  writeBindings<kVisibilityBindings>(ctx_.device(), visibilitySets_[slot],
                                     {camera, splats, values, depthKeys, count, status,
                                      candidateInfo, candidateCountInfo, shInfo, projected},
                                     VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER);
  writeBindings<kPrepareBindings>(ctx_.device(), prepareSets_[slot], {count, indirect, status},
                                  VK_DESCRIPTOR_TYPE_STORAGE_BUFFER);
  return true;
}

void VulkanVisibilityPass::barrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage,
                                   VkPipelineStageFlags dstStage, VkAccessFlags srcAccess,
                                   VkAccessFlags dstAccess, const Output& out) {
  constexpr uint32_t kOutputs = 6;
  VkBufferMemoryBarrier barriers[kOutputs]{};
  const VkBuffer buffers[kOutputs] = {out.values, out.projected, out.depthKeys,
                                      out.count,  out.indirect,  out.status};
  const VkDeviceSize sizes[kOutputs] = {VK_WHOLE_SIZE,
                                        VK_WHOLE_SIZE,
                                        VK_WHOLE_SIZE,
                                        sizeof(uint32_t),
                                        sizeof(VkDrawIndirectCommand),
                                        sizeof(uint32_t)};
  for (uint32_t i = 0; i < kOutputs; ++i) {
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
  vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 0, nullptr, kOutputs, barriers, 0, nullptr);
}

bool VulkanVisibilityPass::encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const {
  const uint32_t bound = candidateBound(input);
  if (cmd == VK_NULL_HANDLE || slot >= kFramesInFlight || capacity_ == 0 ||
      static_cast<uint32_t>(input.mode) > static_cast<uint32_t>(CandidateMode::ranges) ||
      static_cast<uint32_t>(input.keyBits) > static_cast<uint32_t>(KeyBits::low16) ||
      static_cast<uint32_t>(input.keyOrder) > static_cast<uint32_t>(KeyOrder::descending) ||
      input.shDegree < 0 || input.shDegree > kMaxShDegree ||
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

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                    pipelines_->visibility[static_cast<size_t>(input.shDegree)]);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_->visibilityLayout, 0, 1,
                          &visibilitySets_[slot], 0, nullptr);
  const PushConstants push{input.sourceCount,
                           capacity_,
                           groupsX,
                           bound,
                           static_cast<uint32_t>(input.mode),
                           input.rangeCount,
                           (input.keyBits == KeyBits::low16 ? kKeyLow16 : 0u) |
                               (input.keyOrder == KeyOrder::descending ? kKeyDescending : 0u)};
  vkCmdPushConstants(cmd, pipelines_->visibilityLayout, VK_SHADER_STAGE_COMPUTE_BIT, 0,
                     sizeof(push), &push);
  vkCmdDispatch(cmd, groupsX, groupsY, 1);
  barrier(cmd, kComputeStage, kComputeStage, VK_ACCESS_SHADER_WRITE_BIT,
          VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT, out);

  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_->prepare);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_->prepareLayout, 0, 1,
                          &prepareSets_[slot], 0, nullptr);
  vkCmdDispatch(cmd, 1, 1, 1);

  VkBufferMemoryBarrier consumer[6]{};
  consumer[0] = {VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
                 nullptr,
                 VK_ACCESS_SHADER_WRITE_BIT,
                 VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_TRANSFER_READ_BIT,
                 VK_QUEUE_FAMILY_IGNORED,
                 VK_QUEUE_FAMILY_IGNORED,
                 out.values,
                 0,
                 VK_WHOLE_SIZE};
  consumer[1] = consumer[0];
  consumer[1].buffer = out.depthKeys;
  // projected.vert reads the records.
  consumer[5] = consumer[0];
  consumer[5].buffer = out.projected;
  consumer[4] = {VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER,
                 nullptr,
                 VK_ACCESS_SHADER_WRITE_BIT,
                 VK_ACCESS_INDIRECT_COMMAND_READ_BIT | VK_ACCESS_TRANSFER_READ_BIT,
                 VK_QUEUE_FAMILY_IGNORED,
                 VK_QUEUE_FAMILY_IGNORED,
                 out.indirect,
                 0,
                 sizeof(VkDrawIndirectCommand)};
  // Publish compacted value/key/count streams to the subsequent GPU radix pass.
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
                       0, 0, nullptr, 6, consumer, 0, nullptr);
  return true;
}

}  // namespace splatkit

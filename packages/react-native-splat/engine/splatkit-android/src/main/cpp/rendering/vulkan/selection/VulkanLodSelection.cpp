#include "rendering/vulkan/selection/VulkanLodSelection.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

#include "rendering/vulkan/device/VulkanBarriers.h"
#include "rendering/vulkan/device/VulkanShaderModule.h"
#include "rendering/vulkan/layout/VulkanShaderTypes.h"
#include "shaders/lod_selection_comp.h"
#include "splat/lod/LodFile.h"

namespace splatkit {
namespace {
constexpr uint32_t kThreads = 128;
// The uniform camera plus the clusters, leaves, scratch and index storage buffers.
constexpr uint32_t kStorageBindings = 4;
constexpr uint32_t kBindings = 1 + kStorageBindings;
// Scratch words before the frontier, cost and packet regions: the 23 state words, padded.
constexpr size_t kStateWords = 32;
// Mirrors the branches of lod_selection.comp, which also documents the state words.
// Named after the Metal kernels.
enum Phase : uint32_t {
  kReset,
  kEvaluate,
  kScanCosts,
  kBudget,
  kCompact,
  kScanOffsets,
  kCommit,
  kScatter,
  kEmit
};
// Byte offsets of the indirect dispatch arguments in the scratch state words.
constexpr VkDeviceSize kFrontierGroupsOffset = 8 * sizeof(uint32_t);    // one group per 128 nodes
constexpr VkDeviceSize kPacketGroupsOffset = 11 * sizeof(uint32_t);     // one group per packet
constexpr VkDeviceSize kGroupScanGroupsOffset = 16 * sizeof(uint32_t);  // one per 128 group totals
constexpr VkDeviceSize kScatterGroupsOffset =
    20 * sizeof(uint32_t);  // the committed round's groups
}  // namespace

std::shared_ptr<const VulkanLodSelection::Pipelines> VulkanLodSelection::Pipelines::compile(
    const VulkanContext& ctx) {
  static_assert(sizeof(Config) == 52);
  VkPhysicalDeviceProperties properties{};
  vkGetPhysicalDeviceProperties(ctx.physicalDevice(), &properties);
  const VkPhysicalDeviceLimits& limits = properties.limits;
  uint32_t count = 0;
  vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice(), &count, nullptr);
  std::vector<VkQueueFamilyProperties> families(count);
  vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice(), &count, families.data());
  if (ctx.queueFamily() >= count ||
      !(families[ctx.queueFamily()].queueFlags & VK_QUEUE_COMPUTE_BIT) ||
      limits.maxComputeWorkGroupInvocations < kThreads ||
      limits.maxComputeWorkGroupSize[0] < kThreads ||
      limits.maxComputeSharedMemorySize < kThreads * 4 * sizeof(uint32_t) ||
      limits.maxPerStageDescriptorStorageBuffers < kStorageBindings ||
      limits.maxDescriptorSetStorageBuffers < kStorageBindings ||
      limits.maxPerStageDescriptorUniformBuffers < 1 || limits.maxDescriptorSetUniformBuffers < 1 ||
      limits.maxPerStageResources < kBindings ||
      limits.maxUniformBufferRange < sizeof(CameraUniform) ||
      limits.maxPushConstantsSize < sizeof(Config))
    return nullptr;

  VkDevice device = ctx.device();
  auto pipelines = std::make_shared<Pipelines>(device);
  VkDescriptorSetLayoutBinding bindings[kBindings]{};
  bindings[0] = {0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
  for (uint32_t i = 1; i < kBindings; ++i)
    bindings[i] = {i, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr};
  VkDescriptorSetLayoutCreateInfo set{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  set.bindingCount = kBindings;
  set.pBindings = bindings;
  if (vkCreateDescriptorSetLayout(device, &set, nullptr, &pipelines->set) != VK_SUCCESS)
    return nullptr;
  const VkPushConstantRange push{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(Config)};
  VkPipelineLayoutCreateInfo layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  layout.setLayoutCount = 1;
  layout.pSetLayouts = &pipelines->set;
  layout.pushConstantRangeCount = 1;
  layout.pPushConstantRanges = &push;
  if (vkCreatePipelineLayout(device, &layout, nullptr, &pipelines->layout) != VK_SUCCESS)
    return nullptr;
  const VulkanShaderModule module(device, shaders::lod_selection_comp,
                                  shaders::lod_selection_comp_size);
  if (!module) return nullptr;
  VkComputePipelineCreateInfo pipeline{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
  pipeline.layout = pipelines->layout;
  pipeline.stage = {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO};
  pipeline.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
  pipeline.stage.module = module.get();
  pipeline.stage.pName = "main";
  if (vkCreateComputePipelines(device, ctx.pipelineCache(), 1, &pipeline, nullptr,
                               &pipelines->pipeline) != VK_SUCCESS)
    return nullptr;
  return pipelines;
}

VulkanLodSelection::Pipelines::~Pipelines() {
  if (pipeline) vkDestroyPipeline(device, pipeline, nullptr);
  if (layout) vkDestroyPipelineLayout(device, layout, nullptr);
  if (set) vkDestroyDescriptorSetLayout(device, set, nullptr);
}

splat::Result<std::unique_ptr<VulkanLodSelection>> VulkanLodSelection::create(
    const VulkanContext& ctx) {
  return create(ctx, Pipelines::compile(ctx));
}

splat::Result<std::unique_ptr<VulkanLodSelection>> VulkanLodSelection::create(
    const VulkanContext& ctx, std::shared_ptr<const Pipelines> pipelines) {
  if (!pipelines)
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "LOD compute limits or pipeline unavailable"};
  std::unique_ptr<VulkanLodSelection> pass(new VulkanLodSelection(ctx, std::move(pipelines)));
  if (!pass->allocateSets())
    return splat::Error{splat::ErrorCode::gpuUnavailable, "LOD descriptor allocation"};
  return pass;
}

bool VulkanLodSelection::allocateSets() {
  VkPhysicalDeviceProperties properties{};
  vkGetPhysicalDeviceProperties(ctx_.physicalDevice(), &properties);
  limits_ = properties.limits;
  VkDescriptorPoolSize sizes[] = {
      {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, kFramesInFlight},
      {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, kStorageBindings * kFramesInFlight}};
  VkDescriptorPoolCreateInfo pool{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  pool.maxSets = kFramesInFlight;
  pool.poolSizeCount = 2;
  pool.pPoolSizes = sizes;
  if (vkCreateDescriptorPool(ctx_.device(), &pool, nullptr, &pool_) != VK_SUCCESS) return false;
  std::array<VkDescriptorSetLayout, kFramesInFlight> layouts{};
  layouts.fill(pipelines_->set);
  VkDescriptorSetAllocateInfo allocate{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
  allocate.descriptorPool = pool_;
  allocate.descriptorSetCount = kFramesInFlight;
  allocate.pSetLayouts = layouts.data();
  return vkAllocateDescriptorSets(ctx_.device(), &allocate, sets_.data()) == VK_SUCCESS;
}

VulkanLodSelection::~VulkanLodSelection() {
  if (pool_) vkDestroyDescriptorPool(ctx_.device(), pool_, nullptr);
}

bool VulkanLodSelection::upload(const splat::LodTree& tree, uint32_t budget, Quality quality) {
  if (budget == 0 || budget > kMaxBudget || !std::isfinite(quality.pixelLimit) ||
      quality.pixelLimit < 0 || !std::isfinite(quality.colorWeight) || quality.colorWeight < 0)
    return false;
  const auto valid = splat::validateLodTree(tree);
  if (!valid || tree.nodeCount() > std::numeric_limits<uint32_t>::max()) return false;
  splat::LodSelectionData compatibility;
  const auto* data = &tree.selection;
  if (data->clusters.empty()) {
    compatibility = splat::buildLodSelectionData(tree);
    data = &compatibility;
  }
  if (data->clusters.empty() || data->leaves.empty()) return false;
  Config config;
  const uint32_t capacity = std::min(budget, static_cast<uint32_t>(tree.leafCount));
  config.limit = capacity;
  config.pixelLimit = quality.pixelLimit;
  config.colorWeight = quality.colorWeight;
  config.cull = quality.frustumCull;
  const size_t frontier = std::min(size_t{capacity}, data->clusters.size());
  const size_t groups = (frontier + kThreads - 1) / kThreads;
  const size_t blocks = (groups + kThreads - 1) / kThreads;
  const size_t packets = std::min(data->clusters.size(), size_t{capacity} / (kThreads + 1));
  if (groups > limits_.maxComputeWorkGroupCount[0] || packets > limits_.maxComputeWorkGroupCount[0])
    return false;
  size_t words = kStateWords;
  auto region = [&](size_t length) {
    const auto start = static_cast<uint32_t>(words);
    words += length;
    return start;
  };
  config.costs = region(frontier * 2);
  config.offsets = region(frontier * 4);
  config.costGroups = region(groups * 4);
  config.groups = region(groups * 4);
  config.blocks = region((blocks + 1) * 4);
  config.frontier0 = region(frontier);
  config.frontier1 = region(frontier);
  config.packets = region(std::max(packets, size_t{1}) * 4);
  const VkDeviceSize clusterBytes = data->clusters.size() * sizeof(splat::LodCluster);
  const VkDeviceSize leafBytes = data->leaves.size() * sizeof(uint32_t);
  const VkDeviceSize scratchBytes = words * sizeof(uint32_t);
  const VkDeviceSize indexBytes = VkDeviceSize{capacity} * sizeof(uint32_t);
  if (words > std::numeric_limits<uint32_t>::max() ||
      std::max({clusterBytes, leafBytes, scratchBytes, indexBytes}) > limits_.maxStorageBufferRange)
    return false;
  constexpr auto kStorage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
  // Written once at load, in place where the device shares memory.
  auto clusters = VulkanBuffer::deviceLocalMapped(ctx_, clusterBytes, kStorage);
  auto leaves = VulkanBuffer::deviceLocalMapped(ctx_, leafBytes, kStorage);
  auto scratch = VulkanBuffer::deviceLocal(
      ctx_, scratchBytes,
      kStorage | VK_BUFFER_USAGE_INDIRECT_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
  auto indices =
      VulkanBuffer::deviceLocal(ctx_, indexBytes, kStorage | VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
  if (!clusters || !leaves || !scratch || !indices ||
      !clusters->upload(data->clusters.data(), clusterBytes) ||
      !leaves->upload(data->leaves.data(), leafBytes))
    return false;
  clusters_ = std::move(clusters);
  leaves_ = std::move(leaves);
  scratch_ = std::move(scratch);
  indices_ = std::move(indices);
  config_ = config;
  capacity_ = capacity;
  rounds_ = valid.value() + 1;
  return true;
}

VulkanLodSelection::Output VulkanLodSelection::output() const {
  if (!scratch_) return {};
  return {indices_->handle(), scratch_->handle(), capacity_};
}

bool VulkanLodSelection::encode(VkCommandBuffer cmd, uint32_t slot, const Input& input) const {
  if (!cmd || slot >= kFramesInFlight || !scratch_ || !input.camera ||
      input.cameraOffset % limits_.minUniformBufferOffsetAlignment != 0 ||
      input.cameraOffset > std::numeric_limits<VkDeviceSize>::max() - sizeof(CameraUniform))
    return false;
  const VkDescriptorBufferInfo buffers[] = {
      {input.camera, input.cameraOffset, sizeof(CameraUniform)},
      {clusters_->handle(), 0, clusters_->size()},
      {leaves_->handle(), 0, leaves_->size()},
      {scratch_->handle(), 0, scratch_->size()},
      {indices_->handle(), 0, indices_->size()}};
  VkWriteDescriptorSet writes[kBindings]{};
  for (uint32_t i = 0; i < kBindings; ++i) {
    writes[i] = {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
    writes[i].dstSet = sets_[slot];
    writes[i].dstBinding = i;
    writes[i].descriptorCount = 1;
    writes[i].descriptorType =
        i == 0 ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    writes[i].pBufferInfo = &buffers[i];
  }
  vkUpdateDescriptorSets(ctx_.device(), kBindings, writes, 0, nullptr);
  // Inter-frame WAR/WAW plus upload/host writes, including consumers on previous submissions.
  vulkanMemoryBarrier(
      cmd, VK_PIPELINE_STAGE_ALL_COMMANDS_BIT | VK_PIPELINE_STAGE_HOST_BIT,
      VK_ACCESS_MEMORY_WRITE_BIT | VK_ACCESS_MEMORY_READ_BIT | VK_ACCESS_HOST_WRITE_BIT,
      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT | VK_ACCESS_UNIFORM_READ_BIT);
  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_->pipeline);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipelines_->layout, 0, 1,
                          &sets_[slot], 0, nullptr);
  auto dispatch = [&](Phase phase, VkDeviceSize indirectOffset = VK_WHOLE_SIZE) {
    Config config = config_;
    config.phase = phase;
    vkCmdPushConstants(cmd, pipelines_->layout, VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(config),
                       &config);
    if (indirectOffset == VK_WHOLE_SIZE)
      vkCmdDispatch(cmd, 1, 1, 1);
    else
      vkCmdDispatchIndirect(cmd, scratch_->handle(), indirectOffset);
    vulkanMemoryBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT,
                        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT | VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT,
                        VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT |
                            VK_ACCESS_INDIRECT_COMMAND_READ_BIT);
  };
  dispatch(kReset);
  for (uint32_t round = 0; round < rounds_; ++round) {
    dispatch(kEvaluate, kFrontierGroupsOffset);
    dispatch(kScanCosts, kGroupScanGroupsOffset);
    dispatch(kBudget);
    dispatch(kCompact, kFrontierGroupsOffset);
    dispatch(kScanOffsets, kGroupScanGroupsOffset);
    dispatch(kCommit);
    dispatch(kScatter, kScatterGroupsOffset);
  }
  dispatch(kEmit, kPacketGroupsOffset);
  vulkanMemoryBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, VK_ACCESS_SHADER_WRITE_BIT,
                      VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT | VK_PIPELINE_STAGE_VERTEX_SHADER_BIT |
                          VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT | VK_PIPELINE_STAGE_TRANSFER_BIT,
                      VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_INDIRECT_COMMAND_READ_BIT |
                          VK_ACCESS_TRANSFER_READ_BIT);
  return true;
}
}  // namespace splatkit

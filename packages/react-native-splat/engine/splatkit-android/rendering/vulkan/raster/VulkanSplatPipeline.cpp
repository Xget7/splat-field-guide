#include "rendering/vulkan/raster/VulkanSplatPipeline.h"

#include <algorithm>
#include <array>
#include <cstddef>

#include "rendering/vulkan/device/VulkanShaderModule.h"
#include "rendering/vulkan/layout/VulkanShaderTypes.h"
#include "shaders/projected_vert.h"
#include "shaders/splat_frag.h"
#include "splatkit/Log.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {
namespace {

// The bindings of set 0 in projected.vert.
constexpr uint32_t kCameraBinding = 0;
constexpr uint32_t kProjectedBinding = 1;
constexpr uint32_t kProjectedOrderBinding = 2;
constexpr uint32_t kProjectedBindings = 3;
// Each frame slot owns one set with one uniform buffer.
constexpr uint32_t kSetFamilies = 1;
constexpr uint32_t kStorageBindingsPerSlot = kProjectedBindings - 1;

VkWriteDescriptorSet storageWrite(VkDescriptorSet set, uint32_t binding,
                                  const VkDescriptorBufferInfo& info) {
  VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
  write.dstSet = set;
  write.dstBinding = binding;
  write.descriptorCount = 1;
  write.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
  write.pBufferInfo = &info;
  return write;
}

// Binding 0 is the camera uniform, the rest are storage buffers, all read by the vertex stage.
bool createSetLayout(VkDevice device, uint32_t bindingCount, VkDescriptorSetLayout& layout) {
  std::array<VkDescriptorSetLayoutBinding, kProjectedBindings> bindings{};
  for (uint32_t binding = 0; binding < bindingCount; ++binding) {
    bindings[binding] = {binding,
                         binding == kCameraBinding ? VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER
                                                   : VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,
                         1, VK_SHADER_STAGE_VERTEX_BIT, nullptr};
  }
  VkDescriptorSetLayoutCreateInfo info{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  info.bindingCount = bindingCount;
  info.pBindings = bindings.data();
  return vkCreateDescriptorSetLayout(device, &info, nullptr, &layout) == VK_SUCCESS;
}

}  // namespace

splat::Result<std::unique_ptr<VulkanSplatPipeline>> VulkanSplatPipeline::create(
    const VulkanContext& ctx, VkRenderPass renderPass, const VulkanCameraUniforms& cameras) {
  std::unique_ptr<VulkanSplatPipeline> p(new VulkanSplatPipeline(ctx));
  if (!p->createDescriptors(cameras)) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "splat descriptors"};
  }
  if (!p->createPipelines(renderPass)) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "splat pipeline"};
  }
  return p;
}

VulkanSplatPipeline::~VulkanSplatPipeline() {
  VkDevice device = ctx_.device();
  for (VkPipeline pipeline : projectedPipeline_) {
    if (pipeline) vkDestroyPipeline(device, pipeline, nullptr);
  }
  if (projectedLayout_) vkDestroyPipelineLayout(device, projectedLayout_, nullptr);
  if (pool_) vkDestroyDescriptorPool(device, pool_, nullptr);
  if (projectedSetLayout_) vkDestroyDescriptorSetLayout(device, projectedSetLayout_, nullptr);
}

// Binding 0 camera, 1 projected records, 2 draw order. One set per frame in flight so a
// uniform update never races the GPU.
bool VulkanSplatPipeline::createDescriptors(const VulkanCameraUniforms& cameras) {
  VkDevice device = ctx_.device();
  if (!createSetLayout(device, kProjectedBindings, projectedSetLayout_)) return false;

  VkDescriptorPoolSize sizes[2]{};
  sizes[0] = {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, kSetFamilies * kFramesInFlight};
  sizes[1] = {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, kStorageBindingsPerSlot * kFramesInFlight};
  VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  poolInfo.maxSets = kSetFamilies * kFramesInFlight;
  poolInfo.poolSizeCount = 2;
  poolInfo.pPoolSizes = sizes;
  if (vkCreateDescriptorPool(device, &poolInfo, nullptr, &pool_) != VK_SUCCESS) return false;

  const auto allocate = [&](VkDescriptorSetLayout layout,
                            std::array<VkDescriptorSet, kFramesInFlight>& sets) {
    std::array<VkDescriptorSetLayout, kFramesInFlight> layouts;
    layouts.fill(layout);
    VkDescriptorSetAllocateInfo allocInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    allocInfo.descriptorPool = pool_;
    allocInfo.descriptorSetCount = kFramesInFlight;
    allocInfo.pSetLayouts = layouts.data();
    return vkAllocateDescriptorSets(device, &allocInfo, sets.data()) == VK_SUCCESS;
  };
  if (!allocate(projectedSetLayout_, projectedSets_)) return false;

  for (uint32_t i = 0; i < kFramesInFlight; ++i) {
    const VkDescriptorBufferInfo info{cameras.buffer(i), 0, sizeof(CameraUniform)};
    VkWriteDescriptorSet write = storageWrite(projectedSets_[i], kCameraBinding, info);
    write.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
    vkUpdateDescriptorSets(device, 1, &write, 0, nullptr);
  }
  return true;
}

template <size_t N>
bool VulkanSplatPipeline::createGraphicsPipelines(VkRenderPass renderPass, VkShaderModule vertex,
                                                  VkShaderModule fragment,
                                                  VkDescriptorSetLayout setLayout,
                                                  VkPipelineLayout& layout,
                                                  std::array<VkPipeline, N>& pipelines) {
  VkDevice device = ctx_.device();
  // A map entry whose constant the shader does not declare has no effect.
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

  VkPipelineShaderStageCreateInfo stages[2]{};
  stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
  stages[0].module = vertex;
  stages[0].pName = "main";
  stages[0].pSpecializationInfo = &specialization;
  stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
  stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
  stages[1].module = fragment;
  stages[1].pName = "main";

  // No vertex buffers: everything is fetched from storage buffers by instance index.
  const VkPipelineVertexInputStateCreateInfo vertexInput{
      VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
  VkPipelineInputAssemblyStateCreateInfo assembly{
      VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
  assembly.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP;

  VkPipelineViewportStateCreateInfo viewport{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
  viewport.viewportCount = 1;
  viewport.scissorCount = 1;
  VkDynamicState dynamics[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
  VkPipelineDynamicStateCreateInfo dynamic{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
  dynamic.dynamicStateCount = 2;
  dynamic.pDynamicStates = dynamics;

  VkPipelineRasterizationStateCreateInfo raster{
      VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
  raster.polygonMode = VK_POLYGON_MODE_FILL;
  raster.cullMode = VK_CULL_MODE_NONE;
  raster.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
  raster.lineWidth = 1.0f;

  VkPipelineMultisampleStateCreateInfo multisample{
      VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
  multisample.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

  // "Over" compositing, back to front: out = src.a * src + (1 - src.a) * dst.
  VkPipelineColorBlendAttachmentState blendAttachment{};
  blendAttachment.blendEnable = VK_TRUE;
  blendAttachment.srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
  blendAttachment.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
  blendAttachment.colorBlendOp = VK_BLEND_OP_ADD;
  blendAttachment.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
  blendAttachment.dstAlphaBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
  blendAttachment.alphaBlendOp = VK_BLEND_OP_ADD;
  blendAttachment.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                                   VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
  VkPipelineColorBlendStateCreateInfo blend{
      VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
  blend.attachmentCount = 1;
  blend.pAttachments = &blendAttachment;

  VkPipelineLayoutCreateInfo layoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  layoutInfo.setLayoutCount = 1;
  layoutInfo.pSetLayouts = &setLayout;
  if (vkCreatePipelineLayout(device, &layoutInfo, nullptr, &layout) != VK_SUCCESS) return false;

  VkGraphicsPipelineCreateInfo info{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
  info.stageCount = 2;
  info.pStages = stages;
  info.pVertexInputState = &vertexInput;
  info.pInputAssemblyState = &assembly;
  info.pViewportState = &viewport;
  info.pRasterizationState = &raster;
  info.pMultisampleState = &multisample;
  info.pColorBlendState = &blend;
  info.pDynamicState = &dynamic;
  info.layout = layout;
  info.renderPass = renderPass;
  info.subpass = 0;
  bool ok = true;
  for (size_t degree = 0; degree < N && ok; ++degree) {
    constants.shDegree = static_cast<uint32_t>(degree);
    ok = vkCreateGraphicsPipelines(device, ctx_.pipelineCache(), 1, &info, nullptr,
                                   &pipelines[degree]) == VK_SUCCESS;
  }
  return ok;
}

bool VulkanSplatPipeline::createPipelines(VkRenderPass renderPass) {
  VkDevice device = ctx_.device();
  const VulkanShaderModule projected(device, shaders::projected_vert, shaders::projected_vert_size);
  const VulkanShaderModule frag(device, shaders::splat_frag, shaders::splat_frag_size);
  if (!projected || !frag) return false;
  return createGraphicsPipelines(renderPass, projected.get(), frag.get(), projectedSetLayout_,
                                 projectedLayout_, projectedPipeline_);
}

void VulkanSplatPipeline::bindProjected(uint32_t frameSlot, VkBuffer projected, VkBuffer order,
                                        uint32_t capacity) {
  const VkDeviceSize records = std::max(1u, capacity);
  const VkDescriptorBufferInfo projectedInfo{projected, 0, records * sizeof(ProjectedSplat)};
  const VkDescriptorBufferInfo orderInfo{order, 0, records * sizeof(uint32_t)};
  const VkDescriptorSet set = projectedSets_[frameSlot];
  const std::array<VkWriteDescriptorSet, 2> writes{
      storageWrite(set, kProjectedBinding, projectedInfo),
      storageWrite(set, kProjectedOrderBinding, orderInfo)};
  vkUpdateDescriptorSets(ctx_.device(), static_cast<uint32_t>(writes.size()), writes.data(), 0,
                         nullptr);
}

void VulkanSplatPipeline::drawProjected(VkCommandBuffer cmd, uint32_t frameSlot,
                                        VkBuffer arguments) const {
  vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, projectedPipeline_[0]);
  vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, projectedLayout_, 0, 1,
                          &projectedSets_[frameSlot], 0, nullptr);
  vkCmdDrawIndirect(cmd, arguments, 0, 1, sizeof(VkDrawIndirectCommand));
}

}  // namespace splatkit

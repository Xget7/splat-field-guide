#pragma once

#include <cstddef>
#include <cstdint>

#include <vulkan/vulkan.h>

namespace splatkit {

// One global memory barrier; the passes order whole buffers, never single ranges.
inline void memoryBarrier(VkCommandBuffer cmd, VkPipelineStageFlags srcStage,
                          VkAccessFlags srcAccess, VkPipelineStageFlags dstStage,
                          VkAccessFlags dstAccess) {
  VkMemoryBarrier barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
  barrier.srcAccessMask = srcAccess;
  barrier.dstAccessMask = dstAccess;
  vkCmdPipelineBarrier(cmd, srcStage, dstStage, 0, 1, &barrier, 0, nullptr, 0, nullptr);
}

// Shader modules live through one pipeline build; byte sizes match generated shader constants.
class ShaderModule {
 public:
  ShaderModule(VkDevice device, const uint32_t* code, size_t size) : device_(device) {
    VkShaderModuleCreateInfo info{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
    info.codeSize = size;
    info.pCode = code;
    if (vkCreateShaderModule(device, &info, nullptr, &module_) != VK_SUCCESS)
      module_ = VK_NULL_HANDLE;
  }
  ~ShaderModule() {
    if (module_ != VK_NULL_HANDLE) vkDestroyShaderModule(device_, module_, nullptr);
  }
  ShaderModule(const ShaderModule&) = delete;
  ShaderModule& operator=(const ShaderModule&) = delete;

  explicit operator bool() const { return module_ != VK_NULL_HANDLE; }
  VkShaderModule get() const { return module_; }

 private:
  VkDevice device_;
  VkShaderModule module_ = VK_NULL_HANDLE;
};

// Sorted splats need no depth test; wait on prior image access before clearing colour and finishing
// in finalLayout.
inline VkRenderPass createColorRenderPass(VkDevice device, VkFormat format,
                                          VkImageLayout finalLayout,
                                          VkPipelineStageFlags priorStage,
                                          VkAccessFlags priorAccess) {
  VkAttachmentDescription color{};
  color.format = format;
  color.samples = VK_SAMPLE_COUNT_1_BIT;
  color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
  color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
  color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  color.finalLayout = finalLayout;

  const VkAttachmentReference colorRef{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkSubpassDescription subpass{};
  subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
  subpass.colorAttachmentCount = 1;
  subpass.pColorAttachments = &colorRef;

  VkSubpassDependency dependency{};
  dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
  dependency.dstSubpass = 0;
  dependency.srcStageMask = priorStage;
  dependency.srcAccessMask = priorAccess;
  dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

  VkRenderPassCreateInfo info{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
  info.attachmentCount = 1;
  info.pAttachments = &color;
  info.subpassCount = 1;
  info.pSubpasses = &subpass;
  info.dependencyCount = 1;
  info.pDependencies = &dependency;
  VkRenderPass pass = VK_NULL_HANDLE;
  if (vkCreateRenderPass(device, &info, nullptr, &pass) != VK_SUCCESS) return VK_NULL_HANDLE;
  return pass;
}

}

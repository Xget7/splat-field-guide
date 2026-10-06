#include "rendering/vulkan/RenderTarget.h"

#include "rendering/vulkan/VulkanHelpers.h"
#include "splatkit/Log.h"

namespace splatkit {

splat::Result<std::unique_ptr<RenderTarget>> RenderTarget::create(const VulkanContext& ctx,
                                                                  VkFormat format,
                                                                  VkExtent2D extent) {
  std::unique_ptr<RenderTarget> rt(new RenderTarget(ctx));
  rt->extent_ = extent;
  rt->format_ = format;
  VkDevice device = ctx.device();

  VkImageCreateInfo imageInfo{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
  imageInfo.imageType = VK_IMAGE_TYPE_2D;
  imageInfo.format = format;
  imageInfo.extent = {extent.width, extent.height, 1};
  imageInfo.mipLevels = 1;
  imageInfo.arrayLayers = 1;
  imageInfo.samples = VK_SAMPLE_COUNT_1_BIT;
  imageInfo.tiling = VK_IMAGE_TILING_OPTIMAL;
  imageInfo.usage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_SRC_BIT;
  imageInfo.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  VmaAllocationCreateInfo allocInfo{};
  allocInfo.usage = VMA_MEMORY_USAGE_AUTO;
  if (vmaCreateImage(ctx.allocator(), &imageInfo, &allocInfo, &rt->image_, &rt->allocation_,
                     nullptr) != VK_SUCCESS) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "render target image"};
  }

  VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
  viewInfo.image = rt->image_;
  viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
  viewInfo.format = format;
  viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  if (vkCreateImageView(device, &viewInfo, nullptr, &rt->view_) != VK_SUCCESS) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "render target view"};
  }

  // Wait for the previous frame's blit read before clearing this transfer-source image.
  rt->renderPass_ =
      createColorRenderPass(device, format, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                            VK_PIPELINE_STAGE_TRANSFER_BIT, VK_ACCESS_TRANSFER_READ_BIT);
  if (rt->renderPass_ == VK_NULL_HANDLE) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "render target pass"};
  }

  VkFramebufferCreateInfo fbInfo{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
  fbInfo.renderPass = rt->renderPass_;
  fbInfo.attachmentCount = 1;
  fbInfo.pAttachments = &rt->view_;
  fbInfo.width = extent.width;
  fbInfo.height = extent.height;
  fbInfo.layers = 1;
  if (vkCreateFramebuffer(device, &fbInfo, nullptr, &rt->framebuffer_) != VK_SUCCESS) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "render target framebuffer"};
  }
  LOGI("render target %ux%u", extent.width, extent.height);
  return rt;
}

RenderTarget::~RenderTarget() {
  VkDevice device = ctx_.device();
  if (framebuffer_) vkDestroyFramebuffer(device, framebuffer_, nullptr);
  if (renderPass_) vkDestroyRenderPass(device, renderPass_, nullptr);
  if (view_) vkDestroyImageView(device, view_, nullptr);
  if (image_) vmaDestroyImage(ctx_.allocator(), image_, allocation_);
}

void RenderTarget::blitTo(VkCommandBuffer cmd, VkImage swapchainImage,
                          VkExtent2D swapchainExtent) const {
  VkImageMemoryBarrier toDst{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
  toDst.srcAccessMask = 0;
  toDst.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
  toDst.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  toDst.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
  toDst.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  toDst.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  toDst.image = swapchainImage;
  toDst.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  // The acquire semaphore is waited at colour output, so that stage is the source here.
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
                       VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0, nullptr, 1, &toDst);

  VkImageBlit region{};
  region.srcSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
  region.srcOffsets[1] = {static_cast<int32_t>(extent_.width), static_cast<int32_t>(extent_.height),
                          1};
  region.dstSubresource = region.srcSubresource;
  region.dstOffsets[1] = {static_cast<int32_t>(swapchainExtent.width),
                          static_cast<int32_t>(swapchainExtent.height), 1};
  vkCmdBlitImage(cmd, image_, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, swapchainImage,
                 VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region, VK_FILTER_LINEAR);

  VkImageMemoryBarrier toPresent = toDst;
  toPresent.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
  toPresent.dstAccessMask = 0;
  toPresent.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
  toPresent.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0,
                       0, nullptr, 0, nullptr, 1, &toPresent);
}

}

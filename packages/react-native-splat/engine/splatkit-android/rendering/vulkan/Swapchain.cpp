#include "rendering/vulkan/Swapchain.h"

#include "rendering/vulkan/VulkanHelpers.h"
#include "splatkit/Log.h"

namespace splatkit {

splat::Result<std::unique_ptr<Swapchain>> Swapchain::create(const VulkanContext& ctx,
                                                            VkSurfaceKHR surface,
                                                            VkSwapchainKHR previous, bool vsync,
                                                            bool linearBlending) {
  std::unique_ptr<Swapchain> sc(new Swapchain(ctx));

  // UNORM by default: splats blend in the encoded space, which is what the reference
  // rasterizer does and what training optimised for, and an sRGB attachment costs 40%
  // of the frame on Adreno 640. Linear blending asks for sRGB first.
  vkb::SwapchainBuilder builder(ctx.physicalDevice(), ctx.device(), surface, ctx.queueFamily(),
                                ctx.queueFamily());
  const VkSurfaceFormatKHR unorm[] = {
      {VK_FORMAT_R8G8B8A8_UNORM, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR},
      {VK_FORMAT_B8G8R8A8_UNORM, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR}};
  const VkSurfaceFormatKHR srgb[] = {{VK_FORMAT_R8G8B8A8_SRGB, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR},
                                     {VK_FORMAT_B8G8R8A8_SRGB, VK_COLOR_SPACE_SRGB_NONLINEAR_KHR}};
  const VkSurfaceFormatKHR* first = linearBlending ? srgb : unorm;
  const VkSurfaceFormatKHR* second = linearBlending ? unorm : srgb;
  builder.set_desired_format(first[0]).add_fallback_format(first[1]);
  builder.add_fallback_format(second[0]).add_fallback_format(second[1]);
  auto result = builder
                    .set_desired_present_mode(vsync ? VK_PRESENT_MODE_FIFO_KHR
                                                    : VK_PRESENT_MODE_IMMEDIATE_KHR)
                    .add_fallback_present_mode(VK_PRESENT_MODE_MAILBOX_KHR)
                    .add_fallback_present_mode(VK_PRESENT_MODE_FIFO_KHR)
                    .set_desired_min_image_count(3)
                    .set_old_swapchain(previous)
                    .set_pre_transform_flags(VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR)
                    .build();
  if (!result) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain: " + result.error().message()};
  }
  sc->swapchain_ = result.value();

  auto views = sc->swapchain_.get_image_views();
  if (!views) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain image views"};
  }
  sc->imageViews_ = views.value();
  auto images = sc->swapchain_.get_images();
  if (!images) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain images"};
  }
  sc->images_ = images.value();

  if (auto r = sc->createRenderPass(); !r) return r.error();
  if (auto r = sc->createFramebuffers(); !r) return r.error();

  LOGI("Swapchain %ux%u, %u images, format %d, present mode %d", sc->extent().width,
       sc->extent().height, sc->imageCount(), sc->format(), sc->swapchain_.present_mode);
  return sc;
}

Swapchain::~Swapchain() {
  VkDevice device = ctx_.device();
  for (VkFramebuffer fb : framebuffers_) vkDestroyFramebuffer(device, fb, nullptr);
  if (renderPass_ != VK_NULL_HANDLE) vkDestroyRenderPass(device, renderPass_, nullptr);
  swapchain_.destroy_image_views(imageViews_);
  vkb::destroy_swapchain(swapchain_);
}

VkSwapchainKHR Swapchain::release() {
  VkSwapchainKHR handle = swapchain_.swapchain;
  swapchain_.swapchain = VK_NULL_HANDLE;
  return handle;
}

// Ready for presentation at the end. The acquire semaphore is waited at the color output stage,
// so the pass must not write the image before that stage: the dependency says exactly that.
splat::Result<splat::Ok> Swapchain::createRenderPass() {
  renderPass_ = createColorRenderPass(ctx_.device(), format(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR,
                                      VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, 0);
  if (renderPass_ == VK_NULL_HANDLE) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "render pass"};
  }
  return splat::Ok{};
}

splat::Result<splat::Ok> Swapchain::createFramebuffers() {
  framebuffers_.resize(imageViews_.size(), VK_NULL_HANDLE);
  for (size_t i = 0; i < imageViews_.size(); ++i) {
    VkFramebufferCreateInfo info{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
    info.renderPass = renderPass_;
    info.attachmentCount = 1;
    info.pAttachments = &imageViews_[i];
    info.width = extent().width;
    info.height = extent().height;
    info.layers = 1;
    if (vkCreateFramebuffer(ctx_.device(), &info, nullptr, &framebuffers_[i]) != VK_SUCCESS) {
      return splat::Error{splat::ErrorCode::gpuUnavailable, "framebuffer"};
    }
  }
  return splat::Ok{};
}

}  // namespace splatkit

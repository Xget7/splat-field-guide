#include "rendering/vulkan/presentation/VulkanSwapchain.h"

#include <algorithm>
#include <array>
#include <string>
#include <utility>

#include "rendering/vulkan/presentation/VulkanRenderPass.h"
#include "splatkit/Log.h"

namespace splatkit {

namespace {

constexpr uint32_t kDesiredImageCount = 3;
// Colour attachment for the splat pass, transfer destination for the render-scale blit.
constexpr VkImageUsageFlags kImageUsage =
    VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;

uint32_t quarterTurnsOf(VkSurfaceTransformFlagBitsKHR transform) {
  switch (transform) {
    case VK_SURFACE_TRANSFORM_ROTATE_90_BIT_KHR:
      return 1;
    case VK_SURFACE_TRANSFORM_ROTATE_180_BIT_KHR:
      return 2;
    case VK_SURFACE_TRANSFORM_ROTATE_270_BIT_KHR:
      return 3;
    default:
      return 0;
  }
}

VkSurfaceFormatKHR chooseFormat(const std::vector<VkSurfaceFormatKHR>& available,
                                bool linearBlending) {
  // UNORM by default: splats blend in the encoded space, which is what the reference
  // rasterizer does and what training optimised for, and an sRGB attachment costs 40%
  // of the frame on Adreno 640. Linear blending asks for sRGB first.
  constexpr std::array<VkFormat, 2> kUnorm{VK_FORMAT_R8G8B8A8_UNORM, VK_FORMAT_B8G8R8A8_UNORM};
  constexpr std::array<VkFormat, 2> kSrgb{VK_FORMAT_R8G8B8A8_SRGB, VK_FORMAT_B8G8R8A8_SRGB};
  const auto& first = linearBlending ? kSrgb : kUnorm;
  const auto& second = linearBlending ? kUnorm : kSrgb;
  for (const auto& formats : {first, second}) {
    for (const VkFormat format : formats) {
      for (const VkSurfaceFormatKHR& candidate : available) {
        if (candidate.format == format &&
            candidate.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) {
          return candidate;
        }
      }
    }
  }
  return available.front();
}

VkPresentModeKHR choosePresentMode(const std::vector<VkPresentModeKHR>& available, bool vsync) {
  const std::array<VkPresentModeKHR, 2> uncapped{VK_PRESENT_MODE_IMMEDIATE_KHR,
                                                 VK_PRESENT_MODE_MAILBOX_KHR};
  if (!vsync) {
    for (const VkPresentModeKHR mode : uncapped) {
      if (std::find(available.begin(), available.end(), mode) != available.end()) return mode;
    }
  }
  return VK_PRESENT_MODE_FIFO_KHR;
}

VkCompositeAlphaFlagBitsKHR chooseCompositeAlpha(VkCompositeAlphaFlagsKHR supported) {
  // Android reports INHERIT: the window's own opacity, which SurfaceView sets opaque.
  for (const VkCompositeAlphaFlagBitsKHR alpha :
       {VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR, VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR}) {
    if (supported & alpha) return alpha;
  }
  return VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
}

template <typename T, typename Query>
std::vector<T> enumerate(Query query) {
  uint32_t count = 0;
  query(&count, nullptr);
  std::vector<T> items(count);
  query(&count, items.data());
  items.resize(count);
  return items;
}

}  // namespace

splat::Result<std::unique_ptr<VulkanSwapchain>> VulkanSwapchain::create(const VulkanContext& ctx,
                                                                        VkSurfaceKHR surface,
                                                                        VkSwapchainKHR previous,
                                                                        bool vsync,
                                                                        bool linearBlending) {
  std::unique_ptr<VulkanSwapchain> sc(new VulkanSwapchain(ctx));
  const VkPhysicalDevice gpu = ctx.physicalDevice();

  VkSurfaceCapabilitiesKHR caps{};
  if (vkGetPhysicalDeviceSurfaceCapabilitiesKHR(gpu, surface, &caps) != VK_SUCCESS) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain: surface capabilities"};
  }
  const auto formats = enumerate<VkSurfaceFormatKHR>([&](uint32_t* count, VkSurfaceFormatKHR* out) {
    vkGetPhysicalDeviceSurfaceFormatsKHR(gpu, surface, count, out);
  });
  const auto modes = enumerate<VkPresentModeKHR>([&](uint32_t* count, VkPresentModeKHR* out) {
    vkGetPhysicalDeviceSurfacePresentModesKHR(gpu, surface, count, out);
  });
  if (formats.empty())
    return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain: no formats"};
  if ((caps.supportedUsageFlags & kImageUsage) != kImageUsage) {
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "swapchain: images cannot be colour attachments and blit targets"};
  }

  sc->transform_ = preTransformFor(caps.currentTransform);
  sc->quarterTurns_ = quarterTurnsOf(sc->transform_);
  // Android reports currentExtent in the window's orientation; the images take the
  // display's native one (developer.android.com/games/optimize/vulkan-prerotation).
  sc->extent_ = caps.currentExtent;
  if (sc->quarterTurns_ % 2 == 1) std::swap(sc->extent_.width, sc->extent_.height);

  const VkSurfaceFormatKHR format = chooseFormat(formats, linearBlending);
  sc->format_ = format.format;
  sc->presentMode_ = choosePresentMode(modes, vsync);
  uint32_t imageCount = std::max(kDesiredImageCount, caps.minImageCount);
  if (caps.maxImageCount > 0) imageCount = std::min(imageCount, caps.maxImageCount);

  VkSwapchainCreateInfoKHR info{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
  info.surface = surface;
  info.minImageCount = imageCount;
  info.imageFormat = format.format;
  info.imageColorSpace = format.colorSpace;
  info.imageExtent = sc->extent_;
  info.imageArrayLayers = 1;
  info.imageUsage = kImageUsage;
  info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
  info.preTransform = sc->transform_;
  info.compositeAlpha = chooseCompositeAlpha(caps.supportedCompositeAlpha);
  info.presentMode = sc->presentMode_;
  info.clipped = VK_TRUE;
  info.oldSwapchain = previous;
  if (const VkResult created = vkCreateSwapchainKHR(ctx.device(), &info, nullptr, &sc->swapchain_);
      created != VK_SUCCESS) {
    return splat::Error{splat::ErrorCode::gpuUnavailable,
                        "swapchain: vkCreateSwapchainKHR " + std::to_string(created)};
  }
  sc->images_ = enumerate<VkImage>([&](uint32_t* count, VkImage* out) {
    vkGetSwapchainImagesKHR(ctx.device(), sc->swapchain_, count, out);
  });
  if (sc->images_.empty())
    return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain images"};

  if (auto r = sc->createImageViews(); !r) return r.error();
  if (auto r = sc->createRenderPass(); !r) return r.error();
  if (auto r = sc->createFramebuffers(); !r) return r.error();

  LOGI("Swapchain %ux%u, %u quarter turns, %u images, format %d, present mode %d",
       sc->extent_.width, sc->extent_.height, sc->quarterTurns_, sc->imageCount(), sc->format_,
       sc->presentMode_);
  return sc;
}

VulkanSwapchain::~VulkanSwapchain() {
  VkDevice device = ctx_.device();
  for (VkFramebuffer fb : framebuffers_) vkDestroyFramebuffer(device, fb, nullptr);
  if (renderPass_ != VK_NULL_HANDLE) vkDestroyRenderPass(device, renderPass_, nullptr);
  for (VkImageView view : imageViews_) vkDestroyImageView(device, view, nullptr);
  if (swapchain_ != VK_NULL_HANDLE) vkDestroySwapchainKHR(device, swapchain_, nullptr);
}

VkSurfaceTransformFlagBitsKHR VulkanSwapchain::preTransformFor(
    VkSurfaceTransformFlagBitsKHR current) {
  return quarterTurnsOf(current) == 0 ? VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR : current;
}

VkExtent2D VulkanSwapchain::windowExtent() const {
  return quarterTurns_ % 2 == 1 ? VkExtent2D{extent_.height, extent_.width} : extent_;
}

VkSwapchainKHR VulkanSwapchain::release() {
  return std::exchange(swapchain_, VK_NULL_HANDLE);
}

splat::Result<splat::Ok> VulkanSwapchain::createImageViews() {
  imageViews_.resize(images_.size(), VK_NULL_HANDLE);
  for (size_t i = 0; i < images_.size(); ++i) {
    VkImageViewCreateInfo info{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    info.image = images_[i];
    info.viewType = VK_IMAGE_VIEW_TYPE_2D;
    info.format = format_;
    info.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    if (vkCreateImageView(ctx_.device(), &info, nullptr, &imageViews_[i]) != VK_SUCCESS) {
      return splat::Error{splat::ErrorCode::gpuUnavailable, "swapchain image views"};
    }
  }
  return splat::Ok{};
}

// Ready for presentation at the end. The acquire semaphore is waited at the color output stage,
// so the pass must not write the image before that stage: the dependency says exactly that.
splat::Result<splat::Ok> VulkanSwapchain::createRenderPass() {
  renderPass_ = createColorRenderPass(ctx_.device(), format(), VK_IMAGE_LAYOUT_PRESENT_SRC_KHR,
                                      VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, 0);
  if (renderPass_ == VK_NULL_HANDLE) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "render pass"};
  }
  return splat::Ok{};
}

splat::Result<splat::Ok> VulkanSwapchain::createFramebuffers() {
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

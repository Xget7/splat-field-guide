#include "rendering/vulkan/world/VulkanWorld.h"

#include <algorithm>
#include <cstring>
#include <limits>
#include <vector>

#include "splatkit/guide/GuideLayout.h"
#include "splatkit/rendering/GpuLayout.h"

namespace splatkit {
namespace {

// How many bytes of splats one packing and upload window covers.
constexpr size_t kUploadWindowBytes = 2 * 1024 * 1024;

bool hasConsistentArrays(const splat::SplatCloud& cloud) {
  const size_t n = cloud.count();
  return n <= std::numeric_limits<uint32_t>::max() && cloud.positions.size() == n * 3 &&
         cloud.covariances.size() == n * 6 && cloud.colors.size() == n * 3 &&
         cloud.alphas.size() == n && (cloud.labels.empty() || cloud.labels.size() == n);
}

// One byte per record rounded up to whole words, never under the descriptor minimum.
VkDeviceSize labelStreamBytes(size_t records) {
  constexpr size_t kWord = sizeof(uint32_t);
  return std::max(VulkanWorld::kMinLabelBytes, VkDeviceSize{(records + kWord - 1) / kWord * kWord});
}

std::unique_ptr<VulkanBuffer> createLabels(const VulkanContext& ctx, size_t records) {
  return VulkanBuffer::deviceLocalMapped(ctx, labelStreamBytes(records),
                                         VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
}

// Uploads the whole stream, zeros past the last record included, so no word is left undefined.
bool uploadLabels(const VulkanWorld& world, std::vector<uint32_t> words) {
  words.resize(static_cast<size_t>(world.labels->size() / sizeof(uint32_t)), 0u);
  return world.labels->upload(words.data(), world.labels->size());
}

bool allocateOrderStaging(const VulkanContext& ctx, VulkanWorld& world, VkDeviceSize bytes) {
  for (auto& staging : world.orderStaging) {
    staging = VulkanBuffer::hostVisible(ctx, bytes, VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
    if (!staging) return false;
  }
  return true;
}

// Host staging for one upload window.
struct UploadScratch {
  std::vector<GpuSplat> packed;
  std::vector<uint32_t> sh;
  std::vector<uint32_t> order;
};

bool uploadShWindow(const splat::SplatCloud& cloud, const VulkanWorld& world,
                    UploadScratch& scratch, size_t offset, size_t count, size_t stride) {
  packShRange(cloud, world.shDegree, offset, count, scratch.sh.data());
  return world.sh->upload(offset * stride * sizeof(uint32_t), scratch.sh.data(),
                          count * stride * sizeof(uint32_t));
}

bool uploadOrderWindow(const VulkanWorld& world, UploadScratch& scratch, size_t offset,
                       size_t count) {
  for (size_t i = 0; i < count; ++i) scratch.order[i] = static_cast<uint32_t>(offset + i);
  return world.order->upload(offset * sizeof(uint32_t), scratch.order.data(),
                             count * sizeof(uint32_t));
}

// A world in shared memory is packed in place, so a window carries only what is staged.
bool uploadWindow(const splat::SplatCloud& cloud, const VulkanWorld& world, UploadScratch& scratch,
                  size_t offset, size_t count, size_t stride, bool inPlace, bool cpuOrder) {
  if (!inPlace) {
    packSplatRange(cloud, offset, count, scratch.packed.data());
    if (!world.splats->upload(offset * sizeof(GpuSplat), scratch.packed.data(),
                              count * sizeof(GpuSplat)))
      return false;
    if (stride && !uploadShWindow(cloud, world, scratch, offset, count, stride)) return false;
  }
  return !cpuOrder || uploadOrderWindow(world, scratch, offset, count);
}

// Shared memory: the pack writes the GPU's bytes in place, one pass over the cloud as on Metal.
// The first submit that reads them makes the writes visible.
void packInPlace(const splat::SplatCloud& cloud, const VulkanWorld& world, size_t stride) {
  const size_t n = cloud.count();
  if (n == 0) return;
  packSplatRange(cloud, 0, n, static_cast<GpuSplat*>(world.splats->mapped()));
  world.splats->flush(0, n * sizeof(GpuSplat));
  if (stride == 0) return;
  packShRange(cloud, world.shDegree, 0, n, static_cast<uint32_t*>(world.sh->mapped()));
  world.sh->flush(0, n * stride * sizeof(uint32_t));
}

// The one-word placeholders keep the descriptors valid when the order or SH buffer is unused.
bool uploadPlaceholders(const VulkanWorld& world, size_t n, size_t stride, bool cpuOrder) {
  const uint32_t zero = 0;
  if ((!cpuOrder || !n) && !world.order->upload(&zero, sizeof(zero))) return false;
  return (stride && n) || world.sh->upload(&zero, sizeof(zero));
}

bool uploadWindows(const splat::SplatCloud& cloud, const VulkanWorld& world, size_t stride,
                   bool cpuOrder) {
  const size_t n = cloud.count();
  const bool inPlace = world.splats->mapped() && world.sh->mapped();
  if (inPlace) packInPlace(cloud, world, stride);
  if (inPlace && !cpuOrder) return uploadPlaceholders(world, n, stride, cpuOrder);
  // Bounded packing/upload windows: do not retain full packed + mapped copies of a 10M cloud.
  const size_t chunk = kUploadWindowBytes / std::max(sizeof(GpuSplat), stride * sizeof(uint32_t));
  const size_t windowSplats = std::min(n, chunk);
  UploadScratch scratch{std::vector<GpuSplat>(inPlace ? 0 : windowSplats),
                        std::vector<uint32_t>(inPlace ? 0 : windowSplats * stride),
                        std::vector<uint32_t>(cpuOrder ? windowSplats : 0)};
  for (size_t offset = 0; offset < n; offset += chunk) {
    const size_t count = std::min(chunk, n - offset);
    if (!uploadWindow(cloud, world, scratch, offset, count, stride, inPlace, cpuOrder))
      return false;
  }
  return uploadPlaceholders(world, n, stride, cpuOrder);
}

}  // namespace

std::unique_ptr<VulkanWorld> VulkanWorld::upload(const VulkanContext& ctx,
                                                 const splat::SplatCloud& cloud, int maxShDegree,
                                                 bool cpuOrder) {
  if (!hasConsistentArrays(cloud)) return nullptr;
  const size_t n = cloud.count();
  const int requestedDegree = std::clamp(std::min(cloud.shDegree, maxShDegree), 0, kMaxShDegree);
  const int shDegree = carriesSh(cloud, requestedDegree) ? requestedDegree : 0;
  const size_t stride = shDegree ? shStride(shDegree) : 0;
  const VkDeviceSize sourceBytes = std::max(size_t{1}, n) * sizeof(GpuSplat);
  const VkDeviceSize orderBytes = (cpuOrder ? std::max(size_t{1}, n) : 1) * sizeof(uint32_t);
  const VkDeviceSize shBytes = std::max(size_t{1}, n * stride) * sizeof(uint32_t);
  VkPhysicalDeviceProperties properties{};
  vkGetPhysicalDeviceProperties(ctx.physicalDevice(), &properties);
  if (std::max({sourceBytes, orderBytes, shBytes}) > properties.limits.maxStorageBufferRange)
    return nullptr;

  std::unique_ptr<VulkanWorld> world(new VulkanWorld());
  world->count = static_cast<uint32_t>(n);
  world->shDegree = shDegree;
  world->splats =
      VulkanBuffer::deviceLocalMapped(ctx, sourceBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  world->order = VulkanBuffer::deviceLocal(ctx, orderBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  world->sh = VulkanBuffer::deviceLocalMapped(ctx, shBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  world->labels = createLabels(ctx, n);
  if (!world->splats || !world->order || !world->sh || !world->labels) return nullptr;
  if (cpuOrder && !allocateOrderStaging(ctx, *world, orderBytes)) return nullptr;
  if (!uploadWindows(cloud, *world, stride, cpuOrder)) return nullptr;
  if (!uploadLabels(*world, packLabels(cloud))) return nullptr;
  return world;
}

std::unique_ptr<VulkanWorld> VulkanWorld::createSlab(const VulkanContext& ctx, uint32_t capacity,
                                                     int shDegree, bool cpuOrder) {
  if (capacity == 0) return nullptr;
  std::unique_ptr<VulkanWorld> world(new VulkanWorld());
  world->count = capacity;
  world->shDegree = std::clamp(shDegree, 0, kMaxShDegree);
  const VkDeviceSize shBytes =
      world->shDegree > 0 ? VkDeviceSize{capacity} * shStride(world->shDegree) * sizeof(uint32_t)
                          : sizeof(uint32_t);
  VkPhysicalDeviceProperties properties{};
  vkGetPhysicalDeviceProperties(ctx.physicalDevice(), &properties);
  if (std::max(shBytes, VkDeviceSize{capacity} * sizeof(GpuSplat)) >
      properties.limits.maxStorageBufferRange)
    return nullptr;
  world->splats = VulkanBuffer::deviceLocalMapped(ctx, VkDeviceSize{capacity} * sizeof(GpuSplat),
                                                  VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  world->order =
      VulkanBuffer::deviceLocal(ctx, VkDeviceSize{cpuOrder ? capacity : 1u} * sizeof(uint32_t),
                                VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  world->sh = VulkanBuffer::deviceLocalMapped(ctx, shBytes, VK_BUFFER_USAGE_STORAGE_BUFFER_BIT);
  world->labels = createLabels(ctx, capacity);
  if (!world->splats || !world->order || !world->sh || !world->labels) return nullptr;
  if (cpuOrder && !allocateOrderStaging(ctx, *world, VkDeviceSize{capacity} * sizeof(uint32_t)))
    return nullptr;
  // Records no tile has written yet take label 0.
  if (!uploadLabels(*world, {})) return nullptr;
  return world;
}

bool VulkanWorld::uploadTile(uint32_t offset, const splat::SplatCloud& cloud) const {
  const size_t n = cloud.count();
  if (n == 0) return true;
  if (offset > count || n > count - offset) return false;
  if (!cloud.labels.empty() && cloud.labels.size() != n) return false;
  // Vulkan buffers are little-endian, so byte i of the stream is byte i & 3 of word i >> 2, the
  // one guideLabel reads. A tile without labels writes zeros, clearing an earlier tile's range.
  const std::vector<uint8_t> tileLabels =
      cloud.labels.empty() ? std::vector<uint8_t>(n, 0) : cloud.labels;
  if (!labels->upload(VkDeviceSize{offset}, tileLabels.data(), n)) return false;
  const VkDeviceSize splatOffset = VkDeviceSize{offset} * sizeof(GpuSplat);
  const size_t splatBytes = n * sizeof(GpuSplat);
  if (auto* mapped = static_cast<GpuSplat*>(splats->mapped())) {
    packSplatRange(cloud, 0, n, mapped + offset);
    splats->flush(splatOffset, splatBytes);
  } else {
    const std::vector<GpuSplat> packed = packSplats(cloud);
    if (!splats->upload(splatOffset, packed.data(), splatBytes)) return false;
  }
  if (shDegree == 0) return true;
  const size_t stride = shStride(shDegree);
  const VkDeviceSize shOffset = VkDeviceSize{offset} * stride * sizeof(uint32_t);
  const size_t shBytes = n * stride * sizeof(uint32_t);
  const bool carries = carriesSh(cloud, shDegree);
  if (auto* mapped = static_cast<uint32_t*>(sh->mapped())) {
    uint32_t* records = mapped + size_t{offset} * stride;
    if (carries) {
      packShRange(cloud, shDegree, 0, n, records);
    } else {
      std::memset(records, 0, shBytes);
    }
    sh->flush(shOffset, shBytes);
    return true;
  }
  const std::vector<uint32_t> packedSh =
      carries ? packSh(cloud, shDegree) : std::vector<uint32_t>(n * stride, 0);
  return sh->upload(shOffset, packedSh.data(), shBytes);
}

void VulkanWorld::recordOrderUpload(VkCommandBuffer cmd, uint32_t frameSlot,
                                    const uint32_t* drawOrder, uint32_t drawCount) const {
  const VkDeviceSize bytes = std::min(drawCount, count) * sizeof(uint32_t);
  if (bytes == 0 || !orderStaging[frameSlot]) return;
  const VulkanBuffer& staging = *orderStaging[frameSlot];
  std::memcpy(staging.mapped(), drawOrder, static_cast<size_t>(bytes));
  staging.flush(0, bytes);

  // The previous frame may still be reading the order buffer in its vertex shader.
  // Queue order alone does not prevent the copy from overlapping it (write after read),
  // so this barrier makes the transfer wait for those reads.
  VkBufferMemoryBarrier beforeCopy{VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER};
  beforeCopy.srcAccessMask = VK_ACCESS_SHADER_READ_BIT;
  beforeCopy.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
  beforeCopy.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  beforeCopy.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  beforeCopy.buffer = order->handle();
  beforeCopy.offset = 0;
  beforeCopy.size = bytes;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_VERTEX_SHADER_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0,
                       0, nullptr, 1, &beforeCopy, 0, nullptr);

  const VkBufferCopy region{0, 0, bytes};
  vkCmdCopyBuffer(cmd, staging.handle(), order->handle(), 1, &region);

  // And this frame's vertex shader must see the copy complete (read after write).
  VkBufferMemoryBarrier afterCopy = beforeCopy;
  afterCopy.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
  afterCopy.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
  vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_VERTEX_SHADER_BIT, 0,
                       0, nullptr, 1, &afterCopy, 0, nullptr);
}

}  // namespace splatkit

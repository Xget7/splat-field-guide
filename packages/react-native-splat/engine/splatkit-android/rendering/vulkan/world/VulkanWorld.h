#pragma once

#include <array>
#include <cstdint>
#include <memory>

#include <vulkan/vulkan.h>

#include "rendering/vulkan/device/VulkanBuffer.h"
#include "rendering/vulkan/device/VulkanContext.h"
#include "rendering/vulkan/layout/VulkanFrameSlots.h"
#include "rendering/vulkan/layout/VulkanShaderTypes.h"
#include "splat/formats/SplatCloud.h"

namespace splatkit {

// The world on the GPU: splats plus the draw order the sorter writes.
class VulkanWorld {
 public:
  // The most spherical harmonics bands a world holds.
  static constexpr int kMaxShDegree = splatkit::kMaxShDegree;

  // Converts a decoded cloud to the GPU layout and uploads it (blocking). Spherical
  // harmonics above `maxShDegree` are dropped: degree 3 costs 92 bytes per splat.
  static std::unique_ptr<VulkanWorld> upload(const VulkanContext& ctx,
                                             const splat::SplatCloud& cloud, int maxShDegree,
                                             bool cpuOrder);
  // An empty world of `capacity` records at `shDegree`, the slab the tiles of a tiled
  // world land in; nothing is drawn until an order names records that were uploaded. The
  // records and harmonics are mapped where the GPU shares memory with the CPU.
  static std::unique_ptr<VulkanWorld> createSlab(const VulkanContext& ctx, uint32_t capacity,
                                                 int shDegree, bool cpuOrder);
  // Converts a tile into records [offset, offset + count) of a slab: in place where the
  // slab is mapped, else through a blocking staged copy. The caller writes a range only
  // after every frame that drew it finished. Harmonics above the slab's degree are
  // dropped, missing ones are zero.
  bool uploadTile(uint32_t offset, const splat::SplatCloud& cloud) const;

  // Records the copy of a new draw order into the world. Must be called outside a render
  // pass, before `draw` in the same command buffer. `drawOrder` has `drawCount` entries, at
  // most the world's `count`: the sorter leaves out what the frustum cannot see.
  void recordOrderUpload(VkCommandBuffer cmd, uint32_t frameSlot, const uint32_t* drawOrder,
                         uint32_t drawCount) const;

  std::unique_ptr<VulkanBuffer> splats;
  std::unique_ptr<VulkanBuffer> order;
  // Spherical harmonics bands 1 to `shDegree`, rgb halves per coefficient, packed two per
  // uint with no padding. A placeholder of one uint when the degree is 0, so the
  // descriptor is always valid and the degree 0 pipeline never reads it.
  std::unique_ptr<VulkanBuffer> sh;
  int shDegree = 0;
  // One host visible staging buffer per frame slot: the slot's fence guarantees the GPU
  // finished reading it before the CPU writes the next order into it.
  std::array<std::unique_ptr<VulkanBuffer>, kFramesInFlight> orderStaging;
  uint32_t count = 0;

 private:
  VulkanWorld() = default;
};

}  // namespace splatkit

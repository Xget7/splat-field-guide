#pragma once

#import <Metal/Metal.h>

#include <array>
#include <cstdint>

#include "rendering/MetalRadixSort.h"
#include "rendering/MetalShaderTypes.h"

namespace splatkit {

// Projects the first `count` splats of a world, compacts the visible ones, sorts them by
// distance and prepares their indirect draws. Owns the GPU scratch; never commits or
// waits on a command buffer. Call reserve only while idle. All encodes and raster
// consumers use one command queue.
class MetalVisibility {
 public:
  bool create(id<MTLDevice> device, id<MTLLibrary> library);
  // Space for `capacity` splats. Failure preserves the previous allocation.
  bool reserve(uint32_t capacity);
  uint32_t capacity() const { return capacity_; }

  // A count above the reserved capacity fails before encoding any work. The caller owns
  // the uniforms, the label styles (a LabelStyles) and the source buffers and keeps them
  // unchanged until this frame completes.
  bool encode(id<MTLCommandBuffer> cmd, uint32_t slot, id<MTLBuffer> uniforms,
              id<MTLBuffer> labelStyles, id<MTLBuffer> splats, id<MTLBuffer> sh, int shDegree,
              uint32_t count);

  // Indices into projected(), nearest first.
  id<MTLBuffer> order() const { return sort_.values(); }
  id<MTLBuffer> projected() const { return projected_; }
  id<MTLBuffer> drawArguments(uint32_t slot) const { return drawArguments_[slot]; }
  // How many splats survived, readable once the GPU has completed this slot.
  id<MTLBuffer> countBuffer(uint32_t slot) const { return count_[slot]; }
  uint32_t count(uint32_t slot) const {
    return *static_cast<const uint32_t*>(count_[slot].contents);
  }

  static constexpr uint32_t kSlots = 2;
  static constexpr uint32_t kDrawBatches = 7;
  // The draws are partitioned so the raster can mask saturated pixels between them.
  static constexpr uint32_t kDrawArgumentBytes = sizeof(MTLDrawPrimitivesIndirectArguments);

 private:
  static constexpr uint32_t kThreads = 256;
  static constexpr int kShDegrees = 4;

  id<MTLDevice> device_ = nil;
  std::array<id<MTLComputePipelineState>, kShDegrees> visibility_{};
  id<MTLComputePipelineState> prepareDraw_ = nil;
  MetalRadixSort sort_;
  uint32_t capacity_ = 0;
  id<MTLBuffer> projected_ = nil;
  std::array<id<MTLBuffer>, kSlots> count_{};
  std::array<id<MTLBuffer>, kSlots> drawArguments_{};
};

}  // namespace splatkit

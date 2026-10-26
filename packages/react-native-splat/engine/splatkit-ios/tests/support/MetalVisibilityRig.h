#pragma once

#import <Metal/Metal.h>

#include <algorithm>
#include <cstdint>
#include <limits>
#include <vector>

#include "rendering/metal/cull/MetalVisibilityPass.h"
#include "rendering/metal/sort/MetalRadixSort.h"
#include "splatkit/guide/GuideLayout.h"
#include "support/MetalTestContext.h"

namespace splatkit::test {

// The label stream of a world whose splat i carries labels[i], at least 16 bytes long as the
// world's own stream is.
inline id<MTLBuffer> labelStream(const std::vector<uint8_t>& labels) {
  std::vector<uint8_t> bytes(std::max<size_t>(labels.size(), 16), 0);
  std::copy(labels.begin(), labels.end(), bytes.begin());
  return [Gpu::get().device newBufferWithBytes:bytes.data()
                                        length:bytes.size()
                                       options:MTLResourceStorageModeShared];
}

// The frame's guide: `styles` (null draws every part as captured) and the reveal.
inline id<MTLBuffer> guideBuffer(const LabelStyles* styles = nullptr,
                                 float revealLevel = std::numeric_limits<float>::infinity(),
                                 float revealBand = 0) {
  const GuideUniform guide = makeGuideUniform(styles, revealLevel, revealBand);
  return [Gpu::get().device newBufferWithBytes:&guide
                                        length:sizeof(guide)
                                       options:MTLResourceStorageModeShared];
}

// The visibility pass with the sort in the place MetalFrameCompute puts it: the projection, the
// radix sort of the survivors, then the indirect draw arguments, in one command buffer.
// Unless a test sets them, every splat is unlabelled and drawn as captured.
struct VisibilityRig {
  MetalVisibilityPass pass;
  MetalRadixSort sort;
  id<MTLBuffer> labels = nil;
  id<MTLBuffer> guide = nil;

  bool create(KeyBits bits = KeyBits::Full32) {
    return pass.create(Gpu::get().device, Gpu::get().library, bits) &&
           sort.create(Gpu::get().device, Gpu::get().library);
  }
  bool reserve(uint32_t capacity, uint32_t activeCapacity = 0) {
    unlabelled_ = labelStream(std::vector<uint8_t>(capacity, 0));
    return sort.reserve(MetalVisibilityPass::slotsFor(capacity, activeCapacity)) &&
           pass.reserve(capacity, activeCapacity);
  }
  bool encode(id<MTLCommandBuffer> cmd, uint32_t slot, id<MTLBuffer> uniforms, id<MTLBuffer> splats,
              id<MTLBuffer> sh, int shDegree, const SplatRenderer::Range* ranges,
              uint32_t rangeCount, id<MTLBuffer> indices = nil, id<MTLBuffer> activeCount = nil) {
    if (!pass.encodeProject(cmd, slot, uniforms, guide != nil ? guide : asCaptured_, splats,
                            labels != nil ? labels : unlabelled_, sh, shDegree, ranges, rangeCount,
                            sort.keys(), sort.values(), indices, activeCount))
      return false;
    sort.encode(cmd, pass.countBuffer(slot), pass.depthBits());
    pass.encodeIndirect(cmd, slot);
    return true;
  }
  uint32_t count(uint32_t slot) const { return pass.count(slot); }
  id<MTLBuffer> projected() const { return pass.projected(); }
  id<MTLBuffer> drawArguments(uint32_t slot) const { return pass.drawArguments(slot); }
  // The sorted indices into projected().
  id<MTLBuffer> order() const { return sort.values(); }
  // The depth keys as the cull wrote them, which the sort leaves in place.
  id<MTLBuffer> depthKeys() const { return sort.keys(); }

 private:
  id<MTLBuffer> unlabelled_ = labelStream({});
  id<MTLBuffer> asCaptured_ = guideBuffer();
};

}  // namespace splatkit::test

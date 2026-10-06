#pragma once

#import <Metal/Metal.h>

#include <memory>

#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

class MetalWorld {
 public:
  // Blocks until the upload completes. Null when the cloud is malformed or the GPU fails.
  static std::unique_ptr<MetalWorld> upload(id<MTLDevice> device, id<MTLCommandQueue> queue,
                                            const splat::SplatCloud& cloud, int maxShDegree);

  GpuWorldInfo info() const { return {count_, shDegree_}; }
  id<MTLBuffer> splats() const { return splats_; }
  id<MTLBuffer> harmonics() const { return sh_; }

 private:
  MetalWorld() = default;
  id<MTLBuffer> splats_ = nil;
  id<MTLBuffer> sh_ = nil;
  uint32_t count_ = 0;
  int shDegree_ = 0;
};

}

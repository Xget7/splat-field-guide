#pragma once

#import <Metal/Metal.h>

#include <cstring>
#include <vector>

#include "SplatShaderSource.h"

namespace splatkit::test {

// Compile exactly the source shipped by the SDK, once per test executable.
struct Gpu {
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  id<MTLCommandQueue> queue = [device newCommandQueue];
  id<MTLLibrary> library = nil;
  Gpu() {
    NSError* error = nil;
    library = [device newLibraryWithSource:@(SplatShaderSource) options:nil error:&error];
    if (library == nil) NSLog(@"Splat test shader compilation: %@", error);
  }
  static Gpu& get() {
    static Gpu gpu;
    return gpu;
  }

  // Private buffers are invisible to the CPU, so tests stage through a shared copy.
  template <typename T>
  void upload(id<MTLBuffer> destination, const std::vector<T>& items) {
    if (items.empty()) return;
    const size_t bytes = items.size() * sizeof(T);
    id<MTLBuffer> staging = [device newBufferWithBytes:items.data()
                                                length:bytes
                                               options:MTLResourceStorageModeShared];
    copy(staging, destination, bytes);
  }

  template <typename T>
  std::vector<T> readback(id<MTLBuffer> source, size_t count) {
    std::vector<T> items(count);
    if (count == 0) return items;
    const size_t bytes = count * sizeof(T);
    id<MTLBuffer> staging = [device newBufferWithLength:bytes options:MTLResourceStorageModeShared];
    copy(source, staging, bytes);
    std::memcpy(items.data(), staging.contents, bytes);
    return items;
  }

 private:
  void copy(id<MTLBuffer> source, id<MTLBuffer> destination, size_t bytes) {
    id<MTLCommandBuffer> cmd = [queue commandBuffer];
    id<MTLBlitCommandEncoder> blit = [cmd blitCommandEncoder];
    [blit copyFromBuffer:source sourceOffset:0 toBuffer:destination destinationOffset:0 size:bytes];
    [blit endEncoding];
    [cmd commit];
    [cmd waitUntilCompleted];
  }
};

}

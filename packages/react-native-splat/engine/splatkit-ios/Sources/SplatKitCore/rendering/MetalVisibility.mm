#include "rendering/MetalVisibility.h"

#include <algorithm>

#include "rendering/MetalCompute.h"

namespace splatkit {

bool MetalVisibility::create(id<MTLDevice> device, id<MTLLibrary> library) {
  device_ = device;
  bool ok = true;
  for (int degree = 0; degree < kShDegrees; ++degree) {
    MTLFunctionConstantValues* constants = [MTLFunctionConstantValues new];
    const uint32_t value = static_cast<uint32_t>(degree);
    [constants setConstantValue:&value type:MTLDataTypeUInt atIndex:kFnShDegree];
    const auto pipeline = metal::pipeline(device, library, "visibility", constants);
    visibility_[static_cast<size_t>(degree)] = pipeline;
    // The compaction ranks survivors within a SIMD group of 32.
    ok = ok && pipeline != nil && pipeline.threadExecutionWidth == 32 &&
         pipeline.maxTotalThreadsPerThreadgroup >= kThreads;
  }
  prepareDraw_ = metal::pipeline(device, library, "prepareDrawArguments");
  for (uint32_t slot = 0; slot < kSlots; ++slot) {
    count_[slot] = metal::buffer(device, sizeof(uint32_t));
    drawArguments_[slot] = metal::buffer(device, kDrawBatches * kDrawArgumentBytes);
    ok = ok && count_[slot] != nil && drawArguments_[slot] != nil;
  }
  return ok && prepareDraw_ != nil && sort_.create(device, library);
}

bool MetalVisibility::reserve(uint32_t capacity) {
  capacity = std::max(capacity, 1u);
  if (capacity <= capacity_) return true;
  id<MTLBuffer> projected = metal::buffer(device_, size_t{capacity} * sizeof(ProjectedSplat));
  if (projected == nil || !sort_.reserve(capacity)) {
    LOGE("visibility buffers for %u splats failed", capacity);
    return false;
  }
  projected_ = projected;
  capacity_ = capacity;
  return true;
}

bool MetalVisibility::encode(id<MTLCommandBuffer> cmd, uint32_t slot, id<MTLBuffer> uniforms,
                             id<MTLBuffer> labelStyles, id<MTLBuffer> splats, id<MTLBuffer> sh,
                             int shDegree, uint32_t count) {
  if (slot >= kSlots || capacity_ == 0 || count > capacity_) return false;
  id<MTLBlitCommandEncoder> reset = [cmd blitCommandEncoder];
  [reset fillBuffer:count_[slot] range:NSMakeRange(0, sizeof(uint32_t)) value:0];
  [reset endEncoding];

  id<MTLComputeCommandEncoder> cull = [cmd computeCommandEncoder];
  cull.label = @"Splat visibility and projection";
  const int degree = std::clamp(shDegree, 0, kShDegrees - 1);
  [cull setComputePipelineState:visibility_[static_cast<size_t>(degree)]];
  [cull setBuffer:uniforms offset:0 atIndex:0];
  [cull setBuffer:splats offset:0 atIndex:1];
  [cull setBytes:&count length:sizeof(count) atIndex:2];
  [cull setBuffer:sort_.keys() offset:0 atIndex:3];
  [cull setBuffer:sort_.values() offset:0 atIndex:4];
  [cull setBuffer:count_[slot] offset:0 atIndex:5];
  [cull setBuffer:sh offset:0 atIndex:6];
  [cull setBuffer:projected_ offset:0 atIndex:7];
  [cull setBuffer:labelStyles offset:0 atIndex:8];
  const NSUInteger groups = (size_t{std::max(count, 1u)} + kThreads - 1) / kThreads;
  [cull dispatchThreadgroups:MTLSizeMake(groups, 1, 1)
       threadsPerThreadgroup:MTLSizeMake(kThreads, 1, 1)];
  [cull endEncoding];

  sort_.encode(cmd, count_[slot]);
  id<MTLComputeCommandEncoder> draw = [cmd computeCommandEncoder];
  draw.label = @"Splat indirect draw arguments";
  [draw setComputePipelineState:prepareDraw_];
  [draw setBuffer:count_[slot] offset:0 atIndex:0];
  [draw setBuffer:drawArguments_[slot] offset:0 atIndex:1];
  [draw dispatchThreadgroups:MTLSizeMake(1, 1, 1) threadsPerThreadgroup:MTLSizeMake(1, 1, 1)];
  [draw endEncoding];
  return true;
}

}

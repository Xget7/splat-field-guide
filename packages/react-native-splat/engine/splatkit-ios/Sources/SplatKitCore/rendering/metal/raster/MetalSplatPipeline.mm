#include "rendering/metal/raster/MetalSplatPipeline.h"

#include "rendering/metal/guide/MetalGuideBindings.h"
#include "rendering/metal/layout/MetalDrawArguments.h"
#include "splatkit/Log.h"

namespace splatkit {

namespace {
// Field Guide: the simulator lacks framebuffer fetch, which the saturation mask reads, so there
// every batch also draws over saturated pixels: the same picture, only slower.
constexpr bool kSaturationMask = !TARGET_OS_SIMULATOR;
}  // namespace

bool MetalSplatPipeline::create(id<MTLDevice> device, id<MTLLibrary> library,
                                MTLPixelFormat format) {
  format_ = format;
  NSError* error = nil;
  id<MTLFunction> fragment = [library newFunctionWithName:@"splatFragment"];
  for (int degree = 0; degree <= kMaxShDegree; ++degree) {
    MTLFunctionConstantValues* constants = [MTLFunctionConstantValues new];
    uint32_t value = static_cast<uint32_t>(degree);
    [constants setConstantValue:&value type:MTLDataTypeUInt atIndex:kFnShDegree];
    id<MTLFunction> vertex = [library newFunctionWithName:@"splatVertex"
                                           constantValues:constants
                                                    error:&error];
    if (vertex == nil) {
      LOGE("splat vertex function: %s", error.localizedDescription.UTF8String);
      return false;
    }
    MTLRenderPipelineDescriptor* desc = [MTLRenderPipelineDescriptor new];
    desc.vertexFunction = vertex;
    desc.fragmentFunction = fragment;
    desc.colorAttachments[0].pixelFormat = format_;
    desc.depthAttachmentPixelFormat = MetalRenderTarget::kDepthFormat;
    // "Over" compositing, back to front: out = src.a * src + (1 - src.a) * dst.
    desc.colorAttachments[0].blendingEnabled = YES;
    desc.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
    desc.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
    desc.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOne;
    desc.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
    id<MTLRenderPipelineState> state = [device newRenderPipelineStateWithDescriptor:desc
                                                                              error:&error];
    if (state == nil) {
      LOGE("splat pipeline degree %d: %s", degree, error.localizedDescription.UTF8String);
      return false;
    }
    splatPipelines_[static_cast<size_t>(degree)] = state;
  }

  // The GPU order path draws the projections the visibility kernel wrote, front to
  // back with "under" compositing of premultiplied colour onto a clear of zero:
  // out = (1 - dst.a) * src + dst, for colour and coverage alike.
  MTLRenderPipelineDescriptor* under = [MTLRenderPipelineDescriptor new];
  under.vertexFunction = [library newFunctionWithName:@"projectedVertex"];
  under.fragmentFunction = [library newFunctionWithName:@"splatFragmentUnder"];
  under.colorAttachments[0].pixelFormat = format_;
  under.depthAttachmentPixelFormat = MetalRenderTarget::kDepthFormat;
  under.colorAttachments[0].blendingEnabled = YES;
  under.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorOneMinusDestinationAlpha;
  under.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOne;
  under.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOneMinusDestinationAlpha;
  under.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
  projectedPipeline_ = [device newRenderPipelineStateWithDescriptor:under error:&error];
  if (projectedPipeline_ == nil) {
    LOGE("projected pipeline: %s", error.localizedDescription.UTF8String);
    return false;
  }
  // The saturation mask touches the depth buffer only.
  if (kSaturationMask) {
    MTLRenderPipelineDescriptor* mask = [MTLRenderPipelineDescriptor new];
    mask.vertexFunction = [library newFunctionWithName:@"blitVertex"];
    mask.fragmentFunction = [library newFunctionWithName:@"saturationMask"];
    mask.colorAttachments[0].pixelFormat = format_;
    mask.colorAttachments[0].writeMask = MTLColorWriteMaskNone;
    mask.depthAttachmentPixelFormat = MetalRenderTarget::kDepthFormat;
    maskPipeline_ = [device newRenderPipelineStateWithDescriptor:mask error:&error];
    if (maskPipeline_ == nil) {
      LOGE("saturation mask pipeline: %s", error.localizedDescription.UTF8String);
      return false;
    }
  }
  MTLDepthStencilDescriptor* depth = [MTLDepthStencilDescriptor new];
  depth.depthCompareFunction = MTLCompareFunctionLessEqual;
  depth.depthWriteEnabled = NO;
  splatDepth_ = [device newDepthStencilStateWithDescriptor:depth];
  depth.depthCompareFunction = MTLCompareFunctionAlways;
  depth.depthWriteEnabled = YES;
  maskDepth_ = [device newDepthStencilStateWithDescriptor:depth];

  LOGI("pipelines for format %lu", static_cast<unsigned long>(format_));
  return true;
}

void MetalSplatPipeline::encode(id<MTLCommandBuffer> cmd, const MetalRenderTarget& target,
                                id<MTLTexture> drawable, id<MTLBuffer> uniforms,
                                id<MTLBuffer> guide, const MetalWorld* world, int shDegree,
                                const GpuOrder& gpu, uint32_t drawCount, bool gpuOrder) const {
  MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
  id<MTLTexture> colour = target.colorOr(drawable);
  pass.colorAttachments[0].texture = colour;
  pass.colorAttachments[0].loadAction = MTLLoadActionClear;
  pass.colorAttachments[0].storeAction = MTLStoreActionStore;
  // Both orders accumulate onto nothing; the backdrop goes under what coverage is left.
  pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
  // The depth buffer is nil when the caller could not allocate one.
  if (target.depth() != nil) {
    pass.depthAttachment.texture = target.depth();
    pass.depthAttachment.loadAction = MTLLoadActionClear;
    pass.depthAttachment.storeAction = MTLStoreActionDontCare;
    pass.depthAttachment.clearDepth = 1.0;
  }
  id<MTLRenderCommandEncoder> encoder = [cmd renderCommandEncoderWithDescriptor:pass];
  if (world != nullptr && (drawCount > 0 || gpuOrder)) {
    [encoder setVertexBuffer:uniforms offset:0 atIndex:0];
    if (gpuOrder) {
      [encoder setVertexBuffer:gpu.projected offset:0 atIndex:1];
      [encoder setVertexBuffer:gpu.order offset:0 atIndex:2];
      id<MTLBuffer> arguments = gpu.arguments;
      for (uint32_t batch = 0; batch < kDrawBatches; ++batch) {
        // Pixels the earlier batches saturated are masked so later ones skip them.
        if (batch > 0 && kSaturationMask) {
          [encoder setRenderPipelineState:maskPipeline_];
          [encoder setDepthStencilState:maskDepth_];
          [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
        }
        [encoder setRenderPipelineState:projectedPipeline_];
        [encoder setDepthStencilState:splatDepth_];
        [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip
                  indirectBuffer:arguments
            indirectBufferOffset:batch * kDrawArgumentBytes];
      }
    } else {
      const int degree = world->drawDegree(shDegree);
      [encoder setRenderPipelineState:splatPipelines_[static_cast<size_t>(degree)]];
      [encoder setDepthStencilState:splatDepth_];
      [encoder setVertexBuffer:world->splats() offset:0 atIndex:1];
      [encoder setVertexBuffer:world->harmonics() offset:0 atIndex:3];
      [encoder setVertexBuffer:world->order() offset:0 atIndex:2];
      [encoder setVertexBuffer:world->labels() offset:0 atIndex:kGuideLabelsBuffer];
      [encoder setVertexBuffer:guide offset:0 atIndex:kGuideBuffer];
      [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip
                  vertexStart:0
                  vertexCount:4
                instanceCount:drawCount];
    }
  }
  [encoder endEncoding];
}

}  // namespace splatkit

#include "rendering/MetalSplatRenderer.h"

#include <TargetConditionals.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <utility>
#include <vector>

#include "SplatShaderSource.h"
#include "rendering/MetalCompute.h"
#include "rendering/MetalShaderTypes.h"
#include "splat/math/Mat4.h"
#include "splatkit/Log.h"

namespace splatkit {

namespace {
constexpr MTLPixelFormat kDepthFormat = MTLPixelFormatDepth16Unorm;
constexpr MTLPixelFormat kPixelFormat = MTLPixelFormatBGRA8Unorm;
// Front to back coverage accumulates in half floats, which 8 bits would round away.
constexpr MTLPixelFormat kTargetFormat = MTLPixelFormatRGBA16Float;
// The backdrop's resolution divides the target's; it is blurred anyway, so it costs little.
constexpr uint32_t kBackdropDownscale = 8;
// Blur tap spacing in backdrop texels; wider than one, as the fill it softens is already smooth.
constexpr float kBackdropBlurSpacing = 1.5f;
// The simulator lacks framebuffer fetch, so it skips saturation masking and redraws opaque pixels.
constexpr bool kSaturationMask = !TARGET_OS_SIMULATOR;

// Mipmap generation halves each level and drops the odd texel, so the pyramid is a power of two
// for its coarsest level to hold every pixel.
NSUInteger floorPowerOfTwo(NSUInteger value) {
  NSUInteger power = 1;
  while (power * 2 <= value) power *= 2;
  return power;
}

// One full-screen triangle from `source` into `destination`, with optional fragment bytes.
void encodePass(id<MTLCommandBuffer> cmd, id<MTLRenderPipelineState> pipeline,
                id<MTLTexture> source, id<MTLTexture> destination, const void* bytes = nullptr,
                size_t length = 0) {
  MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
  pass.colorAttachments[0].texture = destination;
  pass.colorAttachments[0].loadAction = MTLLoadActionDontCare;
  pass.colorAttachments[0].storeAction = MTLStoreActionStore;
  id<MTLRenderCommandEncoder> encoder = [cmd renderCommandEncoderWithDescriptor:pass];
  [encoder setRenderPipelineState:pipeline];
  [encoder setFragmentTexture:source atIndex:0];
  if (bytes != nullptr) [encoder setFragmentBytes:bytes length:length atIndex:0];
  [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
  [encoder endEncoding];
}
}

std::unique_ptr<MetalSplatRenderer> MetalSplatRenderer::create() {
  std::unique_ptr<MetalSplatRenderer> r(new MetalSplatRenderer());
  r->device_ = MTLCreateSystemDefaultDevice();
  if (r->device_ == nil) {
    LOGE("no Metal device");
    return nullptr;
  }
  // SIMD reductions require supported GPUs; simulator family reporting is unreliable, so shader
  // compilation checks the Mac's GPU.
#if !TARGET_OS_SIMULATOR
  if (![r->device_ supportsFamily:MTLGPUFamilyApple7]) {
    LOGE("SplatKit requires Apple GPU family 7 or newer (A14/M1+)");
    return nullptr;
  }
#endif
  r->queue_ = [r->device_ newCommandQueue];
  NSError* error = nil;
  // SIMD prefix reductions are available on iOS starting with MSL 2.3.
  MTLCompileOptions* options = [MTLCompileOptions new];
  options.languageVersion = MTLLanguageVersion2_3;
  r->library_ = [r->device_ newLibraryWithSource:@(SplatShaderSource) options:options error:&error];
  if (r->library_ == nil) {
    LOGE("shader compilation failed: %s", error.localizedDescription.UTF8String);
    return nullptr;
  }
  if (r->queue_ == nil) return nullptr;
  for (uint32_t slot = 0; slot < kFramesInFlight; ++slot) {
    r->uniforms_[slot] = metal::buffer(r->device_, sizeof(CameraUniform));
    r->labelStyles_[slot] = metal::buffer(r->device_, sizeof(LabelStyles));
    if (r->uniforms_[slot] == nil || r->labelStyles_[slot] == nil) return nullptr;
  }
  if (!r->visibility_.create(r->device_, r->library_)) {
    LOGE("GPU visibility and sort pipelines failed");
    return nullptr;
  }
  if (!r->createPipelines()) return nullptr;
  r->inFlight_ = dispatch_semaphore_create(kFramesInFlight);
  r->description_ = std::string(r->device_.name.UTF8String) + ", Metal";
  LOGI("%s", r->description_.c_str());
  return r;
}

MetalSplatRenderer::~MetalSplatRenderer() {
  waitIdle();
}

// Wait for in-flight GPU reads before releasing world and order buffers.
void MetalSplatRenderer::waitIdle() {
  if (inFlight_ == nullptr) return;
  for (uint32_t i = 0; i < kFramesInFlight; ++i) {
    dispatch_semaphore_wait(inFlight_, DISPATCH_TIME_FOREVER);
  }
  for (uint32_t i = 0; i < kFramesInFlight; ++i) dispatch_semaphore_signal(inFlight_);
}

void MetalSplatRenderer::setLayer(CAMetalLayer* layer) {
  if (layer == layer_) return;
  waitIdle();
  layer_ = layer;
  if (layer_ == nil) return;
  layer_.device = device_;
  layer_.pixelFormat = kPixelFormat;
  layer_.framebufferOnly = YES;
  ++generation_;
}

void MetalSplatRenderer::setDrawableSize(uint32_t width, uint32_t height) {
  if (width == width_ && height == height_) return;
  LOGI("drawable %ux%u, was %ux%u", width, height, width_, height_);
  width_ = width;
  height_ = height;
  ++generation_;
  createTarget();
}

void MetalSplatRenderer::setRenderScale(float scale) {
  scale = std::clamp(scale, 0.1f, 2.0f);
  if (scale == renderScale_) return;
  renderScale_ = scale;
  ++generation_;
  createTarget();
}

Extent MetalSplatRenderer::drawExtent() const {
  if (target_ != nil) {
    return {static_cast<uint32_t>(target_.width), static_cast<uint32_t>(target_.height)};
  }
  return {width_, height_};
}

// GPU-private depth allows parameter-buffer spilling; memoryless attachments can fail large iPhone
// passes with OutOfMemoryForParameterBuffer.
bool MetalSplatRenderer::createDepth(NSUInteger width, NSUInteger height) {
  if (depth_ != nil && depth_.width == width && depth_.height == height) return true;
  MTLTextureDescriptor* desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:kDepthFormat
                                                                                  width:width
                                                                                 height:height
                                                                              mipmapped:NO];
  desc.usage = MTLTextureUsageRenderTarget;
  desc.storageMode = MTLStorageModePrivate;
  depth_ = [device_ newTextureWithDescriptor:desc];
  if (depth_ == nil)
    LOGE("depth buffer %lux%lu failed", (unsigned long)width, (unsigned long)height);
  return depth_ != nil;
}

bool MetalSplatRenderer::createTarget() {
  target_ = nil;
  pyramid_ = nil;
  backdrop_ = nil;
  backdropScratch_ = nil;
  if (width_ == 0 || height_ == 0) return true;
  MTLTextureDescriptor* desc = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:kTargetFormat
                                   width:std::max(1u, static_cast<uint32_t>(width_ * renderScale_))
                                  height:std::max(1u, static_cast<uint32_t>(height_ * renderScale_))
                               mipmapped:NO];
  desc.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
  desc.storageMode = MTLStorageModePrivate;
  target_ = [device_ newTextureWithDescriptor:desc];
  if (target_ == nil) {
    LOGE("render target %lux%lu failed", static_cast<unsigned long>(desc.width),
         static_cast<unsigned long>(desc.height));
    return false;
  }
  desc.width = (desc.width + kBackdropDownscale - 1) / kBackdropDownscale;
  desc.height = (desc.height + kBackdropDownscale - 1) / kBackdropDownscale;
  backdrop_ = [device_ newTextureWithDescriptor:desc];
  backdropScratch_ = [device_ newTextureWithDescriptor:desc];
  desc.width = floorPowerOfTwo(desc.width);
  desc.height = floorPowerOfTwo(desc.height);
  desc.mipmapLevelCount = 1 + static_cast<NSUInteger>(std::log2(std::max(desc.width, desc.height)));
  pyramid_ = [device_ newTextureWithDescriptor:desc];
  if (pyramid_ == nil || backdrop_ == nil || backdropScratch_ == nil) {
    LOGE("backdrop %lux%lu failed", static_cast<unsigned long>(desc.width),
         static_cast<unsigned long>(desc.height));
    target_ = nil;
    return false;
  }
  return true;
}

bool MetalSplatRenderer::createPipelines() {
  NSError* error = nil;
  // Premultiplied front-to-back compositing uses out = (1 - dst.a) * src + dst for colour and
  // coverage.
  MTLRenderPipelineDescriptor* under = [MTLRenderPipelineDescriptor new];
  under.vertexFunction = [library_ newFunctionWithName:@"projectedVertex"];
  under.fragmentFunction = [library_ newFunctionWithName:@"splatFragmentUnder"];
  under.colorAttachments[0].pixelFormat = kTargetFormat;
  under.depthAttachmentPixelFormat = kDepthFormat;
  under.colorAttachments[0].blendingEnabled = YES;
  under.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorOneMinusDestinationAlpha;
  under.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOne;
  under.colorAttachments[0].sourceAlphaBlendFactor = MTLBlendFactorOneMinusDestinationAlpha;
  under.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOne;
  projectedPipeline_ = [device_ newRenderPipelineStateWithDescriptor:under error:&error];
  if (projectedPipeline_ == nil) {
    LOGE("projected pipeline: %s", error.localizedDescription.UTF8String);
    return false;
  }
  if (kSaturationMask) {
    MTLRenderPipelineDescriptor* mask = [MTLRenderPipelineDescriptor new];
    mask.vertexFunction = [library_ newFunctionWithName:@"blitVertex"];
    mask.fragmentFunction = [library_ newFunctionWithName:@"saturationMask"];
    mask.colorAttachments[0].pixelFormat = kTargetFormat;
    mask.colorAttachments[0].writeMask = MTLColorWriteMaskNone;
    mask.depthAttachmentPixelFormat = kDepthFormat;
    maskPipeline_ = [device_ newRenderPipelineStateWithDescriptor:mask error:&error];
    if (maskPipeline_ == nil) {
      LOGE("saturation mask pipeline: %s", error.localizedDescription.UTF8String);
      return false;
    }
  }
  MTLDepthStencilDescriptor* depth = [MTLDepthStencilDescriptor new];
  depth.depthCompareFunction = MTLCompareFunctionLessEqual;
  depth.depthWriteEnabled = NO;
  splatDepth_ = [device_ newDepthStencilStateWithDescriptor:depth];
  depth.depthCompareFunction = MTLCompareFunctionAlways;
  depth.depthWriteEnabled = YES;
  maskDepth_ = [device_ newDepthStencilStateWithDescriptor:depth];

  MTLRenderPipelineDescriptor* blit = [MTLRenderPipelineDescriptor new];
  blit.vertexFunction = [library_ newFunctionWithName:@"blitVertex"];
  auto fullScreen = [&](NSString* fragment, MTLPixelFormat format) {
    blit.fragmentFunction = [library_ newFunctionWithName:fragment];
    blit.colorAttachments[0].pixelFormat = format;
    id<MTLRenderPipelineState> pipeline = [device_ newRenderPipelineStateWithDescriptor:blit
                                                                                  error:&error];
    if (pipeline == nil) {
      LOGE("%s pipeline: %s", fragment.UTF8String, error.localizedDescription.UTF8String);
    }
    return pipeline;
  };
  reducePipeline_ = fullScreen(@"backdropReduce", kTargetFormat);
  pushPipeline_ = fullScreen(@"backdropPush", kTargetFormat);
  blurPipeline_ = fullScreen(@"backdropBlur", kTargetFormat);
  compositePipeline_ = fullScreen(@"compositeFragment", kPixelFormat);
  return reducePipeline_ != nil && pushPipeline_ != nil && blurPipeline_ != nil &&
         compositePipeline_ != nil;
}


bool MetalSplatRenderer::uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) {
  auto world = MetalWorld::upload(device_, queue_, cloud, maxShDegree);
  if (!world) return false;
  waitIdle();
  if (!visibility_.reserve(world->info().count)) return false;
  world_ = std::move(world);
  completedWorldFrame_.store(false);
  return true;
}

std::optional<GpuWorldInfo> MetalSplatRenderer::world() const {
  return world_ ? std::optional<GpuWorldInfo>{world_->info()} : std::nullopt;
}


uint32_t MetalSplatRenderer::takePresentTimes(std::vector<int64_t>* times) {
  times->clear();
  const std::lock_guard<std::mutex> lock(presents_->mutex);
  times->swap(presents_->times);
  return std::exchange(presents_->dropped, 0);
}

bool MetalSplatRenderer::draw(const Frame& frame) {
  if (gpuFailed_.load()) return false;
  if (!ready()) return false;
  dispatch_semaphore_wait(inFlight_, DISPATCH_TIME_FOREVER);
  // Until submitFrame(), every failure returns the acquired slot synchronously.
  if (gpuFailed_.load()) {
    dispatch_semaphore_signal(inFlight_);
    return false;
  }
  // Capture requires a readable drawable before nextDrawable() acquires it.
  if (capture_) layer_.framebufferOnly = NO;
  id<CAMetalDrawable> drawable = [layer_ nextDrawable];
  if (drawable == nil) {
    dispatch_semaphore_signal(inFlight_);
    return false;
  }
  const uint32_t slot = static_cast<uint32_t>(frame_ % kFramesInFlight);
  updateUniforms(frame, slot);

  const bool drewWorld = world_ != nullptr;
  id<MTLCommandBuffer> sort = drewWorld ? encodeVisibilityAndSort(frame, slot) : nil;
  if (drewWorld && sort == nil) {
    // Nothing was committed, so no GPU work can still use this slot.
    dispatch_semaphore_signal(inFlight_);
    return false;
  }

  id<MTLCommandBuffer> cmd = [queue_ commandBuffer];
  encodeRaster(cmd, drewWorld ? slot : kFramesInFlight);
  encodeBackdrop(cmd);
  encodeOutput(cmd, drawable.texture);
  CaptureHandler onCapture;
  id<MTLBuffer> captured = encodeCapture(cmd, drawable.texture, &onCapture);

  // Submit on one queue in dependency order so the final completion releases the slot after all GPU
  // reads.
  if (sort != nil) [sort commit];
  submitFrame(cmd, drawable, drewWorld, captured, std::move(onCapture));
  ++frame_;
  return true;
}

void MetalSplatRenderer::updateUniforms(const Frame& frame, uint32_t slot) {
  const Extent extent = drawExtent();
  CameraUniform u{};
  u.view = frame.view;
  u.proj = frame.proj;
  u.screenSize[0] = static_cast<float>(extent.width);
  u.screenSize[1] = static_cast<float>(extent.height);
  u.focal[0] = u.screenSize[0] * frame.proj.at(0, 0) / 2;
  u.focal[1] = u.screenSize[1] * frame.proj.at(1, 1) / 2;
  u.tanHalfFov[0] = 1 / frame.proj.at(0, 0);
  u.tanHalfFov[1] = 1 / frame.proj.at(1, 1);
  u.cameraPosition[0] = frame.cameraPosition.x;
  u.cameraPosition[1] = frame.cameraPosition.y;
  u.cameraPosition[2] = frame.cameraPosition.z;
  u.reveal[0] = frame.revealLevel;
  u.reveal[1] = frame.revealBand;
  std::memcpy(uniforms_[slot].contents, &u, sizeof(u));
  static const LabelStyles kAsCaptured{};
  const LabelStyles& styles = frame.labelStyles != nullptr ? *frame.labelStyles : kAsCaptured;
  std::memcpy(labelStyles_[slot].contents, styles.data(), sizeof(styles));
}

id<MTLCommandBuffer> MetalSplatRenderer::encodeVisibilityAndSort(const Frame& frame,
                                                                 uint32_t slot) {
  id<MTLCommandBuffer> sort = [queue_ commandBuffer];
  const int degree = std::clamp(std::min(frame.shDegree, world_->info().shDegree), 0, kMaxShDegree);
  if (!visibility_.encode(sort, slot, uniforms_[slot], labelStyles_[slot], world_->splats(),
                          world_->harmonics(), degree, world_->info().count)) {
    LOGE("visibility encode failed");
    return nil;
  }
  std::atomic<double>* sortMillis = &lastSortMillis_;
  std::atomic<uint32_t>* drawn = &lastDrawCount_;
  id<MTLBuffer> countBuffer = visibility_.countBuffer(slot);
  std::atomic<bool>* failed = &gpuFailed_;
  [sort addCompletedHandler:^(id<MTLCommandBuffer> done) {
    if (done.status == MTLCommandBufferStatusError) {
      failed->store(true);
      LOGE("visibility command failed: %s", done.error.localizedDescription.UTF8String);
      return;
    }
    sortMillis->store((done.GPUEndTime - done.GPUStartTime) * 1000.0);
    drawn->store(*static_cast<const uint32_t*>(countBuffer.contents));
  }];
  return sort;
}

// `slot` is the frame's visibility slot, or kFramesInFlight for a frame without a world.
void MetalSplatRenderer::encodeRaster(id<MTLCommandBuffer> cmd, uint32_t slot) {
  MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
  pass.colorAttachments[0].texture = target_;
  pass.colorAttachments[0].loadAction = MTLLoadActionClear;
  pass.colorAttachments[0].storeAction = MTLStoreActionStore;
  pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
  if (createDepth(target_.width, target_.height)) {
    pass.depthAttachment.texture = depth_;
    pass.depthAttachment.loadAction = MTLLoadActionClear;
    pass.depthAttachment.storeAction = MTLStoreActionDontCare;
    pass.depthAttachment.clearDepth = 1.0;
  }
  id<MTLRenderCommandEncoder> encoder = [cmd renderCommandEncoderWithDescriptor:pass];
  if (slot < kFramesInFlight) {
    [encoder setVertexBuffer:uniforms_[slot] offset:0 atIndex:0];
    [encoder setVertexBuffer:visibility_.projected() offset:0 atIndex:1];
    [encoder setVertexBuffer:visibility_.order() offset:0 atIndex:2];
    id<MTLBuffer> arguments = visibility_.drawArguments(slot);
    for (uint32_t batch = 0; batch < MetalVisibility::kDrawBatches; ++batch) {
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
          indirectBufferOffset:batch * MetalVisibility::kDrawArgumentBytes];
    }
  }
  [encoder endEncoding];
}

void MetalSplatRenderer::encodeBackdrop(id<MTLCommandBuffer> cmd) {
  const float footprint[2] = {static_cast<float>(target_.width) / pyramid_.width,
                              static_cast<float>(target_.height) / pyramid_.height};
  encodePass(cmd, reducePipeline_, target_, pyramid_, footprint, sizeof(footprint));
  id<MTLBlitCommandEncoder> mips = [cmd blitCommandEncoder];
  [mips generateMipmapsForTexture:pyramid_];
  [mips endEncoding];
  encodePass(cmd, pushPipeline_, pyramid_, backdrop_);
  const float across[2] = {kBackdropBlurSpacing / backdrop_.width, 0};
  const float down[2] = {0, kBackdropBlurSpacing / backdrop_.height};
  encodePass(cmd, blurPipeline_, backdrop_, backdropScratch_, across, sizeof(across));
  encodePass(cmd, blurPipeline_, backdropScratch_, backdrop_, down, sizeof(down));
}

void MetalSplatRenderer::encodeOutput(id<MTLCommandBuffer> cmd, id<MTLTexture> drawableTexture) {
  MTLRenderPassDescriptor* blit = [MTLRenderPassDescriptor renderPassDescriptor];
  blit.colorAttachments[0].texture = drawableTexture;
  blit.colorAttachments[0].loadAction = MTLLoadActionDontCare;
  blit.colorAttachments[0].storeAction = MTLStoreActionStore;
  id<MTLRenderCommandEncoder> scale = [cmd renderCommandEncoderWithDescriptor:blit];
  [scale setRenderPipelineState:compositePipeline_];
  [scale setFragmentTexture:target_ atIndex:0];
  [scale setFragmentTexture:backdrop_ atIndex:1];
  [scale drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
  [scale endEncoding];
}

id<MTLBuffer> MetalSplatRenderer::encodeCapture(id<MTLCommandBuffer> cmd,
                                                id<MTLTexture> drawableTexture,
                                                CaptureHandler* onCapture) {
  id<MTLBuffer> captured = nil;
  if (capture_) {
    if (drawableTexture.framebufferOnly) {
      LOGW("capture skipped: the drawable is not readable yet");
    } else {
      const NSUInteger bytesPerRow = NSUInteger{width_} * 4;
      captured = [device_ newBufferWithLength:bytesPerRow * height_
                                      options:MTLResourceStorageModeShared];
      id<MTLBlitCommandEncoder> copy = [cmd blitCommandEncoder];
      [copy copyFromTexture:drawableTexture
                       sourceSlice:0
                       sourceLevel:0
                      sourceOrigin:MTLOriginMake(0, 0, 0)
                        sourceSize:MTLSizeMake(width_, height_, 1)
                          toBuffer:captured
                 destinationOffset:0
            destinationBytesPerRow:bytesPerRow
          destinationBytesPerImage:bytesPerRow * height_];
      [copy endEncoding];
      *onCapture = std::move(capture_);
      capture_ = nullptr;
      layer_.framebufferOnly = YES;
    }
  }

  return captured;
}

void MetalSplatRenderer::submitFrame(id<MTLCommandBuffer> cmd, id<CAMetalDrawable> drawable,
                                     bool drewWorld, id<MTLBuffer> captured,
                                     CaptureHandler onCapture) {
  // presentedTime is zero for unseen frames; the simulator lacks presentation handlers and reports
  // no display timing.
#if !TARGET_OS_SIMULATOR
  std::shared_ptr<PresentLog> presents = presents_;
  [drawable addPresentedHandler:^(id<MTLDrawable> shown) {
    const CFTimeInterval time = shown.presentedTime;
    const std::lock_guard<std::mutex> lock(presents->mutex);
    if (time <= 0) {
      ++presents->dropped;
    } else if (presents->times.size() < 1024) {
      presents->times.push_back(static_cast<int64_t>(time * 1e9));
    }
  }];
#endif
  [cmd presentDrawable:drawable];
  dispatch_semaphore_t inFlight = inFlight_;
  std::atomic<double>* gpuMillis = &lastGpuMillis_;
  std::atomic<bool>* failed = &gpuFailed_;
  const uint32_t width = width_;
  const uint32_t height = height_;
  auto* worldFrame = &completedWorldFrame_;
  [cmd addCompletedHandler:^(id<MTLCommandBuffer> done) {
    if (done.status == MTLCommandBufferStatusError) {
      failed->store(true);
      LOGE("render command failed: %s", done.error.localizedDescription.UTF8String);
      // Failed timestamps/capture bytes do not describe a presented frame.
      gpuMillis->store(0.0);
      if (onCapture) onCapture({}, 0, 0);
      dispatch_semaphore_signal(inFlight);
      return;
    }
    gpuMillis->store((done.GPUEndTime - done.GPUStartTime) * 1000.0);
    if (drewWorld && !failed->load()) worldFrame->store(true);
    if (onCapture) {
      const auto* bytes = static_cast<const uint8_t*>(captured.contents);
      onCapture(std::vector<uint8_t>(bytes, bytes + size_t{width} * height * 4), width, height);
    }
    dispatch_semaphore_signal(inFlight);
  }];
  [cmd commit];
}

void MetalSplatRenderer::captureNextFrame(CaptureHandler handler) {
  if (gpuFailed_.load()) {
    if (handler) handler({}, 0, 0);
    return;
  }
  capture_ = std::move(handler);
}

}

#pragma once

#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "rendering/MetalVisibility.h"
#include "rendering/MetalWorld.h"
#include "splatkit/rendering/GpuLayout.h"
#include "splatkit/rendering/SplatRenderer.h"

namespace splatkit {

// Everything between a CAMetalLayer and a presented frame: the device and queue, the
// pipelines, the half-float target the splats are composited into, and the world bound to
// them. Each frame culls and sorts the world on the GPU, draws it front to back and blits
// the result to the drawable. The layer is attached and sized by the view; the world stays
// through a detach. Render thread only, except where noted.
class MetalSplatRenderer final : public SplatRenderer {
 public:
  // Null when the device has no Metal or is older than Apple GPU family 7.
  static std::unique_ptr<MetalSplatRenderer> create();
  ~MetalSplatRenderer() override;

  MetalSplatRenderer(const MetalSplatRenderer&) = delete;
  MetalSplatRenderer& operator=(const MetalSplatRenderer&) = delete;

  // The layer to present to, or nil when the view is going away. The renderer sets its
  // device and pixel format; the view sets its size through `setDrawableSize`.
  void setLayer(CAMetalLayer* layer);
  // The layer's size in pixels. Rebuilds the offscreen target if there is one.
  void setDrawableSize(uint32_t width, uint32_t height);

  void setRenderScale(float scale) override;
  float renderScale() const override { return renderScale_; }

  bool ready() const override { return layer_ != nil && target_ != nil; }
  Extent drawExtent() const override;
  uint32_t generation() const override { return generation_; }

  bool uploadWorld(const splat::SplatCloud& cloud, int maxShDegree) override;
  std::optional<GpuWorldInfo> world() const override;

  bool draw(const Frame& frame) override;

  // Any thread. A successful GPU frame of the current world has finished; uploads
  // alone and background frames do not qualify. Reset when the world is replaced.
  bool hasCompletedWorldFrame() const { return !gpuFailed_.load() && completedWorldFrame_.load(); }

  // Pixels of a presented frame: BGRA, 8 bits each, rows top down, `width` by `height`.
  using CaptureHandler =
      std::function<void(std::vector<uint8_t> bgra, uint32_t width, uint32_t height)>;
  // Hands the next frame's pixels to `handler`, from the GPU's completion thread. One
  // capture at a time; a request while one is pending replaces it.
  void captureNextFrame(CaptureHandler handler);
  double lastGpuMillis() const override { return gpuFailed_.load() ? 0 : lastGpuMillis_.load(); }
  double lastSortMillis() const override { return gpuFailed_.load() ? 0 : lastSortMillis_.load(); }
  uint32_t lastDrawCount() const override { return gpuFailed_.load() ? 0 : lastDrawCount_.load(); }
  bool reportsPresentTimes() const override { return true; }
  uint32_t takePresentTimes(std::vector<int64_t>* times) override;
  const std::string& deviceDescription() const override { return description_; }

  static constexpr int kMaxShDegree = 3;
  static constexpr uint32_t kFramesInFlight = MetalVisibility::kSlots;

 private:
  MetalSplatRenderer() = default;
  bool createPipelines();
  bool createTarget();
  void waitIdle();

  void updateCameraUniforms(const Frame& frame, uint32_t slot);
  // Encode only: draw() commits these in dependency order after validation succeeds.
  id<MTLCommandBuffer> encodeVisibilityAndSort(const Frame& frame, uint32_t slot);
  void encodeRaster(id<MTLCommandBuffer> cmd, uint32_t slot);
  void encodeOutput(id<MTLCommandBuffer> cmd, id<MTLTexture> drawableTexture);
  id<MTLBuffer> encodeCapture(id<MTLCommandBuffer> cmd, id<MTLTexture> drawableTexture,
                              CaptureHandler* onCapture);
  // Transfers the acquired inFlight_ slot to the final completion handler.
  void submitFrame(id<MTLCommandBuffer> cmd, id<CAMetalDrawable> drawable, bool drewWorld,
                   id<MTLBuffer> captured, CaptureHandler onCapture);

  id<MTLDevice> device_ = nil;
  id<MTLCommandQueue> queue_ = nil;
  id<MTLLibrary> library_ = nil;
  // The splats go front to back in batches with a saturation mask between them, the
  // background last, and a blit takes the result to the drawable.
  id<MTLRenderPipelineState> blitPipeline_ = nil;
  id<MTLRenderPipelineState> projectedPipeline_ = nil;
  id<MTLRenderPipelineState> maskPipeline_ = nil;
  id<MTLRenderPipelineState> backgroundPipeline_ = nil;
  id<MTLDepthStencilState> splatDepth_ = nil;  // pass unless masked, never write
  id<MTLDepthStencilState> maskDepth_ = nil;   // always write
  id<MTLTexture> depth_ = nil;                 // GPU-private, the size of the colour target
  bool createDepth(NSUInteger width, NSUInteger height);
  std::array<id<MTLBuffer>, kFramesInFlight> uniforms_{};
  dispatch_semaphore_t inFlight_ = nullptr;

  CAMetalLayer* layer_ = nil;
  uint32_t width_ = 0;
  uint32_t height_ = 0;
  id<MTLTexture> target_ = nil;  // half floats: front to back coverage needs more than 8 bits
  std::unique_ptr<MetalWorld> world_;
  float renderScale_ = 1.0f;
  uint32_t generation_ = 0;
  uint64_t frame_ = 0;
  std::atomic<double> lastGpuMillis_{0};
  // Filled by drawable presented handlers, which can outlive a frame's other state.
  struct PresentLog {
    std::mutex mutex;
    std::vector<int64_t> times;  // display times in nanoseconds, capped while nobody drains
    uint32_t dropped = 0;
  };
  std::shared_ptr<PresentLog> presents_ = std::make_shared<PresentLog>();
  std::atomic<bool> completedWorldFrame_{false};
  MetalVisibility visibility_;
  // A GPU error latches this renderer off. Never repeatedly resubmit failed work.
  std::atomic<bool> gpuFailed_{false};
  std::atomic<double> lastSortMillis_{0};
  std::atomic<uint32_t> lastDrawCount_{0};
  CaptureHandler capture_;
  std::string description_;
};

}  // namespace splatkit

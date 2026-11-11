#include "engine/AndroidEngine.h"

#include <android/log.h>

#include "engine/TraceSection.h"
#include "splatkit/Log.h"

namespace splatkit {
namespace {

constexpr char kPipelineCacheFile[] = "splatkit-vulkan-pipelines.bin";

void logcatSink(LogLevel level, const char* message) {
  const int priority = level == LogLevel::error  ? ANDROID_LOG_ERROR
                       : level == LogLevel::warn ? ANDROID_LOG_WARN
                                                 : ANDROID_LOG_INFO;
  __android_log_write(priority, "SplatKit", message);
}

}  // namespace

splat::Result<std::unique_ptr<AndroidEngine>> AndroidEngine::create(const std::string& cacheDir) {
  setLogSink(&logcatSink);
  std::unique_ptr<AndroidEngine> host(new AndroidEngine());
  auto ctx =
      VulkanContext::create(cacheDir.empty() ? std::string{} : cacheDir + "/" + kPipelineCacheFile);
  if (!ctx) return ctx.error();
  host->ctx_ = std::move(ctx.value());
  host->frameLoop_ = std::make_unique<VulkanFrameLoop>(*host->ctx_);
  if (!host->frameLoop_->valid()) {
    return splat::Error{splat::ErrorCode::gpuUnavailable, "frame loop"};
  }
  auto renderer = std::make_unique<VulkanSplatRenderer>(*host->ctx_, *host->frameLoop_);
  host->renderer_ = renderer.get();
  host->engine_ = std::make_unique<SplatEngine>(std::move(renderer));
  return host;
}

AndroidEngine::~AndroidEngine() {
  engine_.reset();
  frameLoop_.reset();
  if (ctx_) ctx_->waitIdle();
}

void AndroidEngine::setEventSink(EventSink sink) {
  eventSink_ = std::move(sink);
  engine_->setEventSink(
      [this](SplatEngine::Event event, const std::string& message, uint32_t count) {
        if (event == SplatEngine::Event::worldReady) {
          awaitingWorldFrame_ = true;
          worldFrameSplatCount_ = count;
        }
        if (eventSink_) eventSink_(static_cast<int>(event), message, count);
      });
}

void AndroidEngine::render(int64_t frameTimeNanos) {
  const TraceSection section(trace::kFrame);
  // Before the engine samples its stats, which a still scene would otherwise leave stale.
  renderer_->collectCompletedFrames();
  engine_->render(frameTimeNanos);
  traceBenchmark();
  if (awaitingWorldFrame_ && renderer_->hasCompletedWorldFrame()) {
    awaitingWorldFrame_ = false;
    // The frame may have finished during this render: read it, so stats read after the
    // event describe it instead of the stats window from before it.
    renderer_->collectCompletedFrames();
    engine_->publishStats();
    if (eventSink_) eventSink_(kWorldFrameReady, {}, worldFrameSplatCount_);
  }
}

// One async slice over the benchmark turn, so a trace can be cut to the measured window.
void AndroidEngine::traceBenchmark() {
  const bool running = engine_->benchmarkRunning();
  if (running == benchmarkTraced_) return;
  benchmarkTraced_ = running;
  if (running)
    ATrace_beginAsyncSection(trace::kBenchmark, trace::kBenchmarkCookie);
  else
    ATrace_endAsyncSection(trace::kBenchmark, trace::kBenchmarkCookie);
}

}  // namespace splatkit

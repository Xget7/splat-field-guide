#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <vector>

namespace splatkit {

// Snapshots are readable from any thread and refreshed at 2 Hz.
struct Stats {
  // FPS uses the last half-second of display times when available, otherwise submitted frames.
  float fps = 0;
  float frameMillis = 0;  // 1000 / fps
  // The fields below are zero unless the renderer reports when frames reached the display.
  bool presentTiming = false;
  float frameMillisP95 = 0;    // 95th percentile display interval over the last 5 seconds
  float lowFps = 0;            // 1% low: the slowest 1% of those intervals, as a frame rate
  uint32_t droppedFrames = 0;  // submitted but never shown, in the last window
  float gpuMillis = 0;         // GPU time of the last frame, from timestamp queries
  float sortMillis = 0;        // last completed sort
  uint32_t splatCount = 0;
  uint32_t drawnSplatCount = 0;  // last completed visibility result, not source count
};

// The render thread publishes snapshots for any thread to read and logs every two seconds, once
// while idle.
class StatsPublisher {
 public:
  struct Sample {
    double gpuMillis = 0;
    double sortMillis = 0;
    uint32_t drawn = 0;         // splats the last completed frame drew
    uint32_t sourceSplats = 0;  // splats in the file, what hosts count
  };

  // Before onFrame, supply display timestamps in nanoseconds on one clock, oldest first, and the
  // unseen submission count; even empty input enables presented FPS.
  void onPresented(const std::vector<int64_t>& times, uint32_t dropped);
  // Once per vsync, drawn or not. `sample` is called when the window closes.
  void onFrame(int64_t frameTimeNanos, bool rendered, const std::function<Sample()>& sample);
  // Publish completed-frame stats without closing the FPS window so host events expose matching
  // counters.
  void publish(const Sample& sample);

  Stats stats() const;

 private:
  int64_t windowStart_ = 0;
  uint32_t windowFrames_ = 0;
  uint32_t windowsSinceLog_ = 0;
  bool lastLoggedIdle_ = false;
  bool presentTiming_ = false;
  uint32_t windowPresented_ = 0;
  uint32_t windowDropped_ = 0;
  int64_t lastPresent_ = 0;
  struct Interval {
    int64_t end = 0;
    float millis = 0;
  };
  std::deque<Interval> intervals_;  // display intervals of the last five seconds

  std::atomic<float> fps_{0};
  std::atomic<float> frameMillis_{0};
  std::atomic<bool> presentTimingPublished_{false};
  std::atomic<float> frameMillisP95_{0};
  std::atomic<float> lowFps_{0};
  std::atomic<uint32_t> droppedFrames_{0};
  std::atomic<float> gpuMillis_{0};
  std::atomic<float> sortMillis_{0};
  std::atomic<uint32_t> splats_{0};
  std::atomic<uint32_t> drawnSplats_{0};
};

}

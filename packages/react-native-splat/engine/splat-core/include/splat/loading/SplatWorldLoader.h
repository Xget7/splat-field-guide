#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>

#include "splat/core/CoordinateFrame.h"
#include "splat/core/Result.h"
#include "splat/formats/SplatCloud.h"

namespace splat {

// Prepares worlds for a renderer. Decoding runs on whatever thread calls `load`, the
// result waits until the render thread takes it, and a newer load replaces one still
// waiting. A world is decoded from SPZ and reordered spatially. Loads may run
// concurrently; the last one to finish is the one taken.
class SplatWorldLoader {
 public:
  struct WorldReport {
    std::size_t splatCount = 0;
    int shDegree = 0;
    Bounds bounds;
    double decodeMillis = 0;
    double reorderMillis = 0;
  };

  // Highest SH degree materialized for worlds loaded from now on. The source SPZ remains full.
  void setMaxShDegree(int degree);
  int maxShDegree() const { return maxShDegree_.load(); }

  // An SPZ world whose positions are in `sourceFrame`. Errors leave whatever was waiting.
  Result<WorldReport> loadWorld(const std::uint8_t* data, std::size_t size,
                                CoordinateFrame sourceFrame);
  Result<WorldReport> loadWorldFile(const std::string& path, CoordinateFrame sourceFrame);

  // The newest world not yet taken, or nothing.
  std::unique_ptr<SplatCloud> takeWorld();

 private:
  std::atomic<int> maxShDegree_{3};
  std::mutex mutex_;
  std::unique_ptr<SplatCloud> pendingWorld_;
};

}  // namespace splat

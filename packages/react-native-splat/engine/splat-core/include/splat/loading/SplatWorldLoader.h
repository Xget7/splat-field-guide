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

// The caller keeps these bytes alive throughout the call.
struct ByteView {
  const std::uint8_t* data = nullptr;
  std::size_t size = 0;
  bool empty() const { return size == 0; }
};

struct SourceIdentity {
  std::string splatSha256;
  std::string labelsSha256;
  uint32_t expectedSplatCount;
};

// Concurrent loads decode on their calling threads, and the last successful completion replaces the
// pending world for the render thread.
class SplatWorldLoader {
 public:
  struct WorldReport {
    std::size_t splatCount = 0;
    int shDegree = 0;
    bool labelled = false;
    Bounds bounds;
    // splatCount is measured after both filters.
    std::size_t hazeRemoved = 0;
    // Sparse filtering follows haze removal.
    std::size_t sparseRemoved = 0;
    double decodeMillis = 0;
    double reorderMillis = 0;
    double verificationMillis = 0;
    std::size_t sourceSplatCount = 0;
    bool verified = false;
  };

  // Highest SH degree materialized for worlds loaded from now on. The source SPZ remains full.
  void setMaxShDegree(int degree);

  // Absent labels leave splats unlabelled; count/digest mismatches return labelsMismatch before
  // filtering, and errors preserve the pending world.
  Result<WorldReport> loadWorld(ByteView spz, ByteView labels, CoordinateFrame sourceFrame,
                                const SourceIdentity* identity = nullptr);
  // An empty labels path means no labels.
  Result<WorldReport> loadWorldFile(const std::string& spzPath, const std::string& labelsPath,
                                    CoordinateFrame sourceFrame,
                                    const SourceIdentity* identity = nullptr);

  // Transfers the pending world once.
  std::unique_ptr<SplatCloud> takeWorld();
  bool hasWorld() const;

 private:
  std::atomic<int> maxShDegree_{3};
  mutable std::mutex mutex_;
  std::unique_ptr<SplatCloud> pendingWorld_;
};

}

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

// Bytes the caller keeps alive for the duration of a call. Empty is no bytes.
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

// Prepares worlds for a renderer. Decoding runs on whatever thread calls `load`, the
// result waits until the render thread takes it, and a newer load replaces one still
// waiting. A world is decoded from SPZ, given its part labels, cleared of haze and
// floaters, and reordered spatially.
// Loads may run concurrently; the last one to finish is the one taken.
class SplatWorldLoader {
 public:
  struct WorldReport {
    std::size_t splatCount = 0;
    int shDegree = 0;
    bool labelled = false;
    Bounds bounds;
    // Splats removed as haze (see splat/filtering/Haze.h); splatCount is what remains.
    std::size_t hazeRemoved = 0;
    // Splats removed as faint floaters (see splat/filtering/Sparse.h), after the haze.
    std::size_t sparseRemoved = 0;
    double decodeMillis = 0;
    double reorderMillis = 0;
    double verificationMillis = 0;
    std::size_t sourceSplatCount = 0;
    bool verified = false;
  };

  // Highest SH degree materialized for worlds loaded from now on. The source SPZ remains full.
  void setMaxShDegree(int degree);

  // An SPZ world whose positions are in `sourceFrame`, with the labels.bin that labels its
  // splats; without one every splat is unlabelled. Labels for another number of splats
  // or another manifest digest fail as `labelsMismatch`. Identity checks use the source
  // count before filtering. Errors leave whatever was waiting.
  Result<WorldReport> loadWorld(ByteView spz, ByteView labels, CoordinateFrame sourceFrame,
                                const SourceIdentity* identity = nullptr);
  // The same from files, mapped rather than read. An empty labels path means no labels.
  Result<WorldReport> loadWorldFile(const std::string& spzPath, const std::string& labelsPath,
                                    CoordinateFrame sourceFrame,
                                    const SourceIdentity* identity = nullptr);

  // The newest world not yet taken, or nothing.
  std::unique_ptr<SplatCloud> takeWorld();
  // Whether a world waits to be taken.
  bool hasWorld() const;

 private:
  std::atomic<int> maxShDegree_{3};
  mutable std::mutex mutex_;
  std::unique_ptr<SplatCloud> pendingWorld_;
};

}  // namespace splat

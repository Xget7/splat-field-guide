#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>

#include "splat/core/Result.h"
#include "splat/formats/SplatCloud.h"
#include "splat/lod/LodTree.h"

namespace splat {

// The caller keeps these bytes alive throughout the call.
struct ByteView {
  const std::uint8_t* data = nullptr;
  std::size_t size = 0;
  bool empty() const { return size == 0; }
};

// What the pack manifest says a tier's files are.
struct SourceIdentity {
  std::string worldSha256;
  std::string labelsSha256;
  // The tree's leaves: the splats left of the capture after the pack was prepared.
  uint32_t expectedSplatCount;
};

// Loads a pack tier as it ships: a SplatKit .lodsplat tree, prepared offline, with one part
// label per tree node in node order. Concurrent loads decode on their calling threads, and the
// last successful completion replaces the pending world for the render thread.
class SplatWorldLoader {
 public:
  struct WorldReport {
    // The tree's leaves, the splats the capture kept.
    std::size_t splatCount = 0;
    std::size_t nodeCount = 0;
    int shDegree = 0;
    bool labelled = false;
    Bounds bounds;
    double decodeMillis = 0;
    double verificationMillis = 0;
    bool verified = false;
  };

  // Highest SH degree materialized for worlds loaded from now on. The source file remains full.
  void setMaxShDegree(int degree);

  // Absent labels leave the tree unlabelled; a digest or a count that disagrees with the tree
  // returns labelsMismatch before decoding, and errors preserve the pending world.
  Result<WorldReport> loadWorld(ByteView world, ByteView labels,
                                const SourceIdentity* identity = nullptr);
  // An empty labels path means no labels.
  Result<WorldReport> loadWorldFile(const std::string& worldPath, const std::string& labelsPath,
                                    const SourceIdentity* identity = nullptr);

  // Transfers the pending world once.
  std::unique_ptr<LodTree> takeWorld();
  bool hasWorld() const;

 private:
  std::atomic<int> maxShDegree_{3};
  mutable std::mutex mutex_;
  std::unique_ptr<LodTree> pendingWorld_;
};

}  // namespace splat

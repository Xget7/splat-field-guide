#include "splat/loading/SplatWorldLoader.h"

#include <algorithm>
#include <chrono>
#include <optional>
#include <string>
#include <utility>

#include "Sha256.h"

#include "splat/formats/PartLabels.h"
#include "splat/io/MappedFile.h"
#include "splat/lod/LodFile.h"

namespace splat {
namespace {

using Clock = std::chrono::steady_clock;
constexpr std::size_t kSha256Bytes = 32;
constexpr char kInvalidIdentity[] = "Pack source identity is invalid";
constexpr char kWorldDigestMismatch[] = "World SHA-256 does not match the pack manifest";
constexpr char kLabelsDigestMismatch[] = "Part labels SHA-256 does not match the pack manifest";
constexpr char kSplatCountMismatch[] = "World splat count does not match the pack manifest";

bool validDigest(const std::string& digest) {
  return digest.size() == kSha256Bytes * 2 && std::all_of(digest.begin(), digest.end(), [](char c) {
           return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
         });
}

double millisSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

}  // namespace

void SplatWorldLoader::setMaxShDegree(int degree) {
  maxShDegree_.store(std::clamp(degree, 0, 3));
}

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorld(ByteView world, ByteView labels,
                                                                  const SourceIdentity* identity) {
  WorldReport report;
  auto start = Clock::now();
  if (identity) {
    if (!validDigest(identity->worldSha256) || !validDigest(identity->labelsSha256) ||
        identity->expectedSplatCount == 0)
      return Error{ErrorCode::corrupt, kInvalidIdentity};
    const auto labelsDigest = detail::sha256(labels);
    if (!labelsDigest) return labelsDigest.error();
    if (labelsDigest.value() != identity->labelsSha256)
      return Error{ErrorCode::labelsMismatch, kLabelsDigestMismatch};
    const auto worldDigest = detail::sha256(world);
    if (!worldDigest) return worldDigest.error();
    if (worldDigest.value() != identity->worldSha256)
      return Error{ErrorCode::corrupt, kWorldDigestMismatch};
    report.verificationMillis = millisSince(start);
    report.verified = true;
  }
  start = Clock::now();
  // The header and the labels are checked before the tree is decoded: they are a small fraction
  // of the bytes.
  const auto header = readLodSplatHeader(world.data, world.size);
  if (!header) return header.error();
  if (identity && header.value().leafCount != identity->expectedSplatCount)
    return Error{ErrorCode::corrupt, kSplatCountMismatch};
  std::vector<std::uint8_t> partLabels;
  if (!labels.empty()) {
    auto decodedLabels = decodePartLabels(labels.data, labels.size);
    if (!decodedLabels) return decodedLabels.error();
    partLabels = std::move(decodedLabels.value());
    // Labels counted by the leaves, or for another tree, would style the wrong nodes.
    if (partLabels.size() != header.value().nodeCount) {
      return Error{ErrorCode::labelsMismatch,
                   std::to_string(partLabels.size()) + " part labels for " +
                       std::to_string(header.value().nodeCount) + " tree nodes"};
    }
  }
  auto decoded = decodeLodSplat(world.data, world.size, maxShDegree_.load());
  if (!decoded) return decoded.error();
  auto tree = std::make_unique<LodTree>(std::move(decoded.value()));
  tree->nodes.labels = std::move(partLabels);
  report.decodeMillis = millisSince(start);
  report.splatCount = tree->leafCount;
  report.nodeCount = tree->nodeCount();
  report.shDegree = tree->nodes.shDegree;
  report.labelled = !tree->nodes.labels.empty();
  report.bounds = tree->nodes.bounds;

  const std::lock_guard<std::mutex> lock(mutex_);
  pendingWorld_ = std::move(tree);
  return report;
}

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorldFile(
    const std::string& worldPath, const std::string& labelsPath, const SourceIdentity* identity) {
  auto world = MappedFile::open(worldPath);
  if (!world) return world.error();
  std::optional<MappedFile> labels;
  if (!labelsPath.empty()) {
    auto mapped = MappedFile::open(labelsPath);
    if (!mapped) return mapped.error();
    labels.emplace(std::move(mapped.value()));
  }
  return loadWorld({world.value().data(), world.value().size()},
                   labels ? ByteView{labels->data(), labels->size()} : ByteView{}, identity);
}

std::unique_ptr<LodTree> SplatWorldLoader::takeWorld() {
  const std::lock_guard<std::mutex> lock(mutex_);
  return std::move(pendingWorld_);
}

bool SplatWorldLoader::hasWorld() const {
  const std::lock_guard<std::mutex> lock(mutex_);
  return pendingWorld_ != nullptr;
}

}  // namespace splat

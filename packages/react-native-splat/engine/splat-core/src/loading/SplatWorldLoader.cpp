#include "splat/loading/SplatWorldLoader.h"

#include <algorithm>
#include <chrono>
#include <optional>
#include <string>
#include <utility>

#include "Sha256.h"

#include "splat/filtering/Haze.h"
#include "splat/filtering/Sparse.h"
#include "splat/formats/PartLabels.h"
#include "splat/formats/SpzDecoder.h"
#include "splat/io/MappedFile.h"
#include "splat/sorting/SpatialOrder.h"

namespace splat {
namespace {

using Clock = std::chrono::steady_clock;
constexpr std::size_t kSha256Bytes = 32;
constexpr char kInvalidIdentity[] = "Pack source identity is invalid";
constexpr char kSplatDigestMismatch[] = "Cloud SHA-256 does not match the pack manifest";
constexpr char kLabelsDigestMismatch[] = "Part labels SHA-256 does not match the pack manifest";
constexpr char kSplatCountMismatch[] = "Cloud splat count does not match the pack manifest";

bool validDigest(const std::string& digest) {
  return digest.size() == kSha256Bytes * 2 && std::all_of(digest.begin(), digest.end(), [](char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
  });
}

double millisSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

}

void SplatWorldLoader::setMaxShDegree(int degree) {
  maxShDegree_.store(std::clamp(degree, 0, 3));
}

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorld(ByteView spz, ByteView labels,
                                                                  CoordinateFrame sourceFrame,
                                                                  const SourceIdentity* identity) {
  WorldReport report;
  auto start = Clock::now();
  if (identity) {
    if (!validDigest(identity->splatSha256) || !validDigest(identity->labelsSha256) ||
        identity->expectedSplatCount == 0) return Error{ErrorCode::corrupt, kInvalidIdentity};
    const auto labelsDigest = detail::sha256(labels);
    if (!labelsDigest) return labelsDigest.error();
    if (labelsDigest.value() != identity->labelsSha256)
      return Error{ErrorCode::labelsMismatch, kLabelsDigestMismatch};
    const auto splatDigest = detail::sha256(spz);
    if (!splatDigest) return splatDigest.error();
    if (splatDigest.value() != identity->splatSha256)
      return Error{ErrorCode::corrupt, kSplatDigestMismatch};
    report.verificationMillis = millisSince(start);
    report.verified = true;
  }
  start = Clock::now();
  // The labels are checked first: they are a small fraction of the bytes.
  std::vector<std::uint8_t> partLabels;
  if (!labels.empty()) {
    auto decodedLabels = decodePartLabels(labels.data, labels.size);
    if (!decodedLabels) return decodedLabels.error();
    partLabels = std::move(decodedLabels.value());
  }
  SpzDecodeOptions options;
  options.sourceFrame = sourceFrame;
  options.maxShDegree = maxShDegree_.load();
  auto decoded = decodeSpz(spz.data, spz.size, options);
  if (!decoded) return decoded.error();
  auto cloud = std::make_unique<SplatCloud>(std::move(decoded.value()));
  report.sourceSplatCount = cloud->count();
  if (identity && report.sourceSplatCount != identity->expectedSplatCount)
    return Error{ErrorCode::corrupt, kSplatCountMismatch};
  if (!labels.empty() && partLabels.size() != cloud->count()) {
    return Error{ErrorCode::labelsMismatch,
                 std::to_string(partLabels.size()) + " part labels for " +
                     std::to_string(cloud->count()) + " splats"};
  }
  cloud->labels = std::move(partLabels);
  report.hazeRemoved = removeHaze(*cloud);
  report.sparseRemoved = removeSparse(*cloud);
  report.decodeMillis = millisSince(start);
  report.splatCount = cloud->count();
  report.shDegree = cloud->shDegree;
  report.labelled = !cloud->labels.empty();
  report.bounds = cloud->bounds;

  start = Clock::now();
  reorderSpatially(*cloud);
  report.reorderMillis = millisSince(start);

  const std::lock_guard<std::mutex> lock(mutex_);
  pendingWorld_ = std::move(cloud);
  return report;
}

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorldFile(
    const std::string& spzPath, const std::string& labelsPath, CoordinateFrame sourceFrame,
    const SourceIdentity* identity) {
  auto spz = MappedFile::open(spzPath);
  if (!spz) return spz.error();
  std::optional<MappedFile> labels;
  if (!labelsPath.empty()) {
    auto mapped = MappedFile::open(labelsPath);
    if (!mapped) return mapped.error();
    labels.emplace(std::move(mapped.value()));
  }
  return loadWorld({spz.value().data(), spz.value().size()},
                   labels ? ByteView{labels->data(), labels->size()} : ByteView{}, sourceFrame, identity);
}

std::unique_ptr<SplatCloud> SplatWorldLoader::takeWorld() {
  const std::lock_guard<std::mutex> lock(mutex_);
  return std::move(pendingWorld_);
}

bool SplatWorldLoader::hasWorld() const {
  const std::lock_guard<std::mutex> lock(mutex_);
  return pendingWorld_ != nullptr;
}

}

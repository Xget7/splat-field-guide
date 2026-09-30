#include "splat/loading/SplatWorldLoader.h"

#include <algorithm>
#include <chrono>
#include <optional>
#include <string>
#include <utility>

#include "splat/formats/PartLabels.h"
#include "splat/formats/SpzDecoder.h"
#include "splat/io/MappedFile.h"
#include "splat/sorting/SpatialOrder.h"

namespace splat {
namespace {

using Clock = std::chrono::steady_clock;

double millisSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

}  // namespace

void SplatWorldLoader::setMaxShDegree(int degree) {
  maxShDegree_.store(std::clamp(degree, 0, 3));
}

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorld(ByteView spz, ByteView labels,
                                                                  CoordinateFrame sourceFrame) {
  WorldReport report;
  auto start = Clock::now();
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
  if (!labels.empty() && partLabels.size() != cloud->count()) {
    return Error{ErrorCode::labelsMismatch,
                 std::to_string(partLabels.size()) + " part labels for " +
                     std::to_string(cloud->count()) + " splats"};
  }
  cloud->labels = std::move(partLabels);
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
    const std::string& spzPath, const std::string& labelsPath, CoordinateFrame sourceFrame) {
  auto spz = MappedFile::open(spzPath);
  if (!spz) return spz.error();
  std::optional<MappedFile> labels;
  if (!labelsPath.empty()) {
    auto mapped = MappedFile::open(labelsPath);
    if (!mapped) return mapped.error();
    labels.emplace(std::move(mapped.value()));
  }
  return loadWorld({spz.value().data(), spz.value().size()},
                   labels ? ByteView{labels->data(), labels->size()} : ByteView{}, sourceFrame);
}

std::unique_ptr<SplatCloud> SplatWorldLoader::takeWorld() {
  const std::lock_guard<std::mutex> lock(mutex_);
  return std::move(pendingWorld_);
}

bool SplatWorldLoader::hasWorld() const {
  const std::lock_guard<std::mutex> lock(mutex_);
  return pendingWorld_ != nullptr;
}

}  // namespace splat

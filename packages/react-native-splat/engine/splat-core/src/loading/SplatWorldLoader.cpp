#include "splat/loading/SplatWorldLoader.h"

#include <algorithm>
#include <chrono>
#include <utility>

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

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorld(const std::uint8_t* data,
                                                                  std::size_t size,
                                                                  CoordinateFrame sourceFrame) {
  WorldReport report;
  auto start = Clock::now();
  SpzDecodeOptions options;
  options.sourceFrame = sourceFrame;
  options.maxShDegree = maxShDegree_.load();
  auto decoded = decodeSpz(data, size, options);
  if (!decoded) return decoded.error();
  report.decodeMillis = millisSince(start);
  auto cloud = std::make_unique<SplatCloud>(std::move(decoded.value()));
  report.splatCount = cloud->count();
  report.shDegree = cloud->shDegree;
  report.bounds = cloud->bounds;

  start = Clock::now();
  reorderSpatially(*cloud);
  report.reorderMillis = millisSince(start);

  const std::lock_guard<std::mutex> lock(mutex_);
  pendingWorld_ = std::move(cloud);
  return report;
}

Result<SplatWorldLoader::WorldReport> SplatWorldLoader::loadWorldFile(const std::string& path,
                                                                      CoordinateFrame sourceFrame) {
  auto file = MappedFile::open(path);
  if (!file) return file.error();
  return loadWorld(file.value().data(), file.value().size(), sourceFrame);
}

std::unique_ptr<SplatCloud> SplatWorldLoader::takeWorld() {
  const std::lock_guard<std::mutex> lock(mutex_);
  return std::move(pendingWorld_);
}

}  // namespace splat

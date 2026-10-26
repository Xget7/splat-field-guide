#include <charconv>
#include <chrono>
#include <cstdio>
#include <exception>
#include <memory>
#include <string>

#include "splat/filtering/Haze.h"
#include "splat/filtering/Sparse.h"
#include "splat/formats/PartLabels.h"
#include "splat/formats/SplatDecoder.h"
#include "splat/io/MappedFile.h"
#include "splat/lod/LodFile.h"

namespace {
// Field Guide: a pack tier's part labels, read with the cloud and written in node order.
struct LabelFiles {
  std::string in;
  std::string out;
};

// Field Guide: the labels ride on the cloud, then haze and sparse floaters leave it before the
// build, because a tree is built once on the final cloud and its merged nodes would carry them.
splat::Result<splat::Ok> prepareLabelledCloud(splat::SplatCloud& cloud, const std::string& path) {
  auto mapped = splat::MappedFile::open(path);
  if (!mapped) return mapped.error();
  auto labels = splat::decodePartLabels(mapped.value().data(), mapped.value().size());
  if (!labels) return labels.error();
  if (labels.value().size() != cloud.count())
    return splat::Error{splat::ErrorCode::labelsMismatch,
                        std::to_string(labels.value().size()) + " part labels for " +
                            std::to_string(cloud.count()) + " splats"};
  cloud.labels = std::move(labels.value());
  const std::size_t haze = splat::removeHaze(cloud);
  const std::size_t sparse = splat::removeSparse(cloud);
  std::printf("removed %zu haze and %zu sparse splats\n", haze, sparse);
  return splat::Ok{};
}

// Field Guide: like writeLodSplat, never replaces an existing file.
splat::Result<splat::Ok> writeNodeLabels(const splat::LodTree& tree, const std::string& path) {
  const auto bytes = splat::encodePartLabels(tree.nodes.labels);
  const auto closeFile = [](FILE* handle) { std::fclose(handle); };
  std::unique_ptr<FILE, decltype(closeFile)> file(std::fopen(path.c_str(), "wbx"), closeFile);
  if (!file)
    return splat::Error{splat::ErrorCode::unreadable,
                        "cannot create labels output (exists or unwritable)"};
  bool ok = std::fwrite(bytes.data(), 1, bytes.size(), file.get()) == bytes.size();
  ok = std::fclose(file.release()) == 0 && ok;
  if (!ok) return splat::Error{splat::ErrorCode::unreadable, "labels write failed"};
  return splat::Ok{};
}

int run(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr,
                 "usage: splat_lod_build input.spz output.lodsplat [--depth 1..%u] [--sh 0..3]"
                 " [--frame rdf|rub] [--labels in.bin out.bin]\n",
                 splat::kMaxOctreeDepth);
    return 2;
  }
  splat::LodBuildOptions build;
  splat::SplatDecodeOptions decode;
  LabelFiles labels;
  for (int i = 3; i < argc; i += 2) {
    const std::string key(argv[i]);
    if (i + 1 >= argc) return 2;
    const std::string text(argv[i + 1]);
    // Field Guide: a pack's cloud is written in RUB, where World Labs exports are RDF.
    if (key == "--frame") {
      if (text != "rdf" && text != "rub") return 2;
      decode.sourceFrame =
          text == "rub" ? splat::CoordinateFrame::rub : splat::CoordinateFrame::rdf;
      continue;
    }
    if (key == "--labels") {
      if (i + 2 >= argc) return 2;
      labels = {text, argv[i + 2]};
      ++i;
      continue;
    }
    int value = 0;
    const auto parsed = std::from_chars(text.data(), text.data() + text.size(), value);
    if (parsed.ec != std::errc{} || parsed.ptr != text.data() + text.size()) return 2;
    if (key == "--depth" && value >= 1 && value <= static_cast<int>(splat::kMaxOctreeDepth))
      build.octreeDepth = static_cast<uint32_t>(value);
    else if (key == "--sh" && value >= 0 && value <= 3)
      decode.maxShDegree = value;
    else
      return 2;
  }
  const auto start = std::chrono::steady_clock::now();
  // Mapping is released before building the hierarchy, limiting peak resident memory.
  auto cloud = [&]() -> splat::Result<splat::SplatCloud> {
    auto mapped = splat::MappedFile::open(argv[1]);
    if (!mapped) return mapped.error();
    return splat::decodeSplatFile(mapped.value().data(), mapped.value().size(), decode);
  }();
  if (!cloud) {
    std::fprintf(stderr, "%s\n", cloud.error().message.c_str());
    return 1;
  }
  if (!labels.in.empty()) {
    const auto prepared = prepareLabelledCloud(cloud.value(), labels.in);
    if (!prepared) {
      std::fprintf(stderr, "%s\n", prepared.error().message.c_str());
      return 1;
    }
  }
  std::printf("decoded %zu splats, SH%d; building depth %u octree\n", cloud.value().count(),
              cloud.value().shDegree, build.octreeDepth);
  std::fflush(stdout);
  auto tree = splat::buildLodTree(std::move(cloud.value()), build);
  tree.selection = splat::buildLodSelectionData(tree);
  auto written = splat::writeLodSplat(tree, argv[2]);
  if (!written) {
    std::fprintf(stderr, "%s\n", written.error().message.c_str());
    return 1;
  }
  if (!labels.out.empty()) {
    written = writeNodeLabels(tree, labels.out);
    if (!written) {
      std::fprintf(stderr, "%s\n", written.error().message.c_str());
      return 1;
    }
  }
  const double seconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
  std::printf("wrote %zu nodes (%zu original leaves), %.2f seconds: %s\n", tree.nodeCount(),
              tree.leafCount, seconds, argv[2]);
  return 0;
}
}  // namespace

int main(int argc, char** argv) {
  try {
    return run(argc, argv);
  } catch (const std::exception& e) {
    std::fprintf(stderr, "splat_lod_build failed: %s\n", e.what());
    return 1;
  }
}

#include "splat/loading/SplatWorldLoader.h"

#include <cstdio>
#include <fstream>
#include <random>
#include <string>
#include <vector>

#include <gtest/gtest.h>

#include "load-spz.h"
#include "splat/formats/PartLabels.h"
#include "splat/formats/SpzDecoder.h"

namespace splat {
namespace {

std::vector<std::uint8_t> encodeSpz(int points) {
  spz::GaussianCloud cloud;
  cloud.numPoints = points;
  std::mt19937 rng(3);
  std::uniform_real_distribution<float> u(-2.0f, 2.0f);
  for (int i = 0; i < points; ++i) {
    for (int k = 0; k < 3; ++k) cloud.positions.push_back(u(rng));
    for (int k = 0; k < 3; ++k) cloud.scales.push_back(-3.0f);
    cloud.rotations.insert(cloud.rotations.end(), {0.0f, 0.0f, 0.0f, 1.0f});
    cloud.alphas.push_back(0.0f);
    for (int k = 0; k < 3; ++k) cloud.colors.push_back(0.0f);
  }
  std::vector<std::uint8_t> bytes;
  EXPECT_TRUE(spz::saveSpz(cloud, spz::PackOptions{}, &bytes));
  return bytes;
}

// A labels.bin for `count` splats, labelling splat i with i % 256.
std::vector<std::uint8_t> encodeLabels(std::uint32_t count) {
  std::vector<std::uint8_t> bytes(part_labels::kHeaderBytes + count, 0);
  std::copy(std::begin(part_labels::kMagic), std::end(part_labels::kMagic), bytes.begin());
  bytes[4] = part_labels::kVersion;
  bytes[6] = part_labels::kBytesPerLabel;
  for (int i = 0; i < 4; ++i) bytes[8 + i] = static_cast<std::uint8_t>(count >> (8 * i));
  for (std::uint32_t i = 0; i < count; ++i) {
    bytes[part_labels::kHeaderBytes + i] = static_cast<std::uint8_t>(i);
  }
  return bytes;
}

ByteView view(const std::vector<std::uint8_t>& bytes) {
  return {bytes.data(), bytes.size()};
}

std::string writeTemp(const std::string& name, const std::vector<std::uint8_t>& bytes) {
  const std::string path = testing::TempDir() + "/" + name;
  std::ofstream out(path, std::ios::binary);
  out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  return path;
}

constexpr CoordinateFrame kFrame = CoordinateFrame::rub;

TEST(SplatWorldLoader, NothingIsWaitingAtFirst) {
  SplatWorldLoader loader;
  EXPECT_FALSE(loader.hasWorld());
  EXPECT_EQ(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, TheCloudWaitsForTheRenderer) {
  SplatWorldLoader loader;
  const auto bytes = encodeSpz(50);
  auto report = loader.loadWorld(view(bytes), {}, kFrame);
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_EQ(report.value().splatCount, 50u);
  EXPECT_TRUE(loader.hasWorld());

  auto world = loader.takeWorld();
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->count(), 50u);
  EXPECT_FALSE(loader.hasWorld());
  EXPECT_EQ(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, BadBytesFailAndLeaveTheWaitingWorld) {
  SplatWorldLoader loader;
  const auto bytes = encodeSpz(10);
  ASSERT_TRUE(loader.loadWorld(view(bytes), {}, kFrame).ok());
  const std::uint8_t junk[] = {1, 2, 3, 4, 5, 6, 7, 8};
  auto failed = loader.loadWorld({junk, sizeof(junk)}, {}, kFrame);
  ASSERT_FALSE(failed.ok());
  EXPECT_EQ(failed.error().code, ErrorCode::unsupportedFormat);
  EXPECT_NE(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, ANewerLoadReplacesTheWaitingOne) {
  SplatWorldLoader loader;
  const auto ten = encodeSpz(10);
  const auto twenty = encodeSpz(20);
  ASSERT_TRUE(loader.loadWorld(view(ten), {}, kFrame).ok());
  ASSERT_TRUE(loader.loadWorld(view(twenty), {}, kFrame).ok());
  auto world = loader.takeWorld();
  ASSERT_NE(world, nullptr);
  EXPECT_EQ(world->count(), 20u);
  EXPECT_EQ(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, TheSourceFrameReachesTheDecoder) {
  const auto bytes = encodeSpz(10);
  SplatWorldLoader rub;
  SplatWorldLoader rdf;
  ASSERT_TRUE(rub.loadWorld(view(bytes), {}, CoordinateFrame::rub).ok());
  ASSERT_TRUE(rdf.loadWorld(view(bytes), {}, CoordinateFrame::rdf).ok());
  const auto up = rub.takeWorld();
  const auto down = rdf.takeWorld();
  // RDF to RUB flips Y and Z, so the bounds mirror.
  EXPECT_FLOAT_EQ(up->bounds.max[1], -down->bounds.min[1]);
  EXPECT_FLOAT_EQ(up->bounds.max[2], -down->bounds.min[2]);
  EXPECT_FLOAT_EQ(up->bounds.max[0], down->bounds.max[0]);
}

TEST(SplatWorldLoader, EachSplatKeepsItsLabelThroughTheReorder) {
  // Labels encode source indices so they can verify attribute alignment after reordering.
  const auto bytes = encodeSpz(200);
  const auto labels = encodeLabels(200);
  SplatWorldLoader plain;
  SplatWorldLoader labelled;
  ASSERT_TRUE(plain.loadWorld(view(bytes), {}, kFrame).ok());
  auto report = labelled.loadWorld(view(bytes), view(labels), kFrame);
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_TRUE(report.value().labelled);
  const auto without = plain.takeWorld();
  const auto with = labelled.takeWorld();
  EXPECT_TRUE(without->labels.empty());
  ASSERT_EQ(with->labels.size(), 200u);
  const auto decoded = decodeSpz(bytes.data(), bytes.size(), SpzDecodeOptions{kFrame, 3});
  ASSERT_TRUE(decoded.ok());
  for (std::size_t i = 0; i < with->count(); ++i) {
    const std::size_t from = with->labels[i];
    for (int k = 0; k < 3; ++k) {
      EXPECT_EQ(with->positions[i * 3 + k], decoded.value().positions[from * 3 + k]);
    }
  }
}

TEST(SplatWorldLoader, LabelsForAnotherCloudFailAndLeaveTheWaitingWorld) {
  SplatWorldLoader loader;
  const auto bytes = encodeSpz(10);
  ASSERT_TRUE(loader.loadWorld(view(bytes), {}, kFrame).ok());
  const auto labels = encodeLabels(11);
  auto failed = loader.loadWorld(view(bytes), view(labels), kFrame);
  ASSERT_FALSE(failed.ok());
  EXPECT_EQ(failed.error().code, ErrorCode::labelsMismatch);
  EXPECT_EQ(failed.error().message, "11 part labels for 10 splats");
  auto world = loader.takeWorld();
  ASSERT_NE(world, nullptr);
  EXPECT_TRUE(world->labels.empty());
}

TEST(SplatWorldLoader, LoadsAWorldAndItsLabelsFromFiles) {
  const std::string spz = writeTemp("world-loader-test.spz", encodeSpz(30));
  const std::string labels = writeTemp("world-loader-test.bin", encodeLabels(30));
  SplatWorldLoader loader;
  auto report = loader.loadWorldFile(spz, labels, kFrame);
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_EQ(report.value().splatCount, 30u);
  EXPECT_TRUE(report.value().labelled);
  ASSERT_NE(loader.takeWorld(), nullptr);

  report = loader.loadWorldFile(spz, "", kFrame);
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_FALSE(report.value().labelled);
  ASSERT_NE(loader.takeWorld(), nullptr);

  auto missing = loader.loadWorldFile("/nonexistent/world.spz", labels, kFrame);
  ASSERT_FALSE(missing.ok());
  EXPECT_EQ(missing.error().code, ErrorCode::unreadable);
  missing = loader.loadWorldFile(spz, "/nonexistent/labels.bin", kFrame);
  ASSERT_FALSE(missing.ok());
  EXPECT_EQ(missing.error().code, ErrorCode::unreadable);
  EXPECT_EQ(loader.takeWorld(), nullptr);
  std::remove(spz.c_str());
  std::remove(labels.c_str());
}

}
}

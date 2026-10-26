#include "splat/loading/SplatWorldLoader.h"

#include <cstdio>
#include <fstream>
#include <iterator>
#include <random>
#include <string>
#include <vector>

#include <gtest/gtest.h>

#include "splat/formats/PartLabels.h"
#include "splat/lod/LodFile.h"

namespace splat {
namespace {

std::string tempPath(const std::string& name) {
  return testing::TempDir() + "/" + name;
}

// A .lodsplat as the pack ships it: the tree over `leaves` random splats with its selection data.
std::vector<std::uint8_t> treeBytes(int leaves) {
  SplatCloud cloud;
  std::mt19937 rng(3);
  std::uniform_real_distribution<float> u(-2.0f, 2.0f);
  cloud.bounds.min = {-2, -2, -2};
  cloud.bounds.max = {2, 2, 2};
  for (int i = 0; i < leaves; ++i) {
    for (int k = 0; k < 3; ++k) cloud.positions.push_back(u(rng));
    cloud.covariances.insert(cloud.covariances.end(), {0.01f, 0, 0, 0.01f, 0, 0.01f});
    cloud.colors.insert(cloud.colors.end(), {0.5f, 0.5f, 0.5f});
    cloud.alphas.push_back(0.5f);
  }
  LodTree tree = buildLodTree(std::move(cloud));
  tree.selection = buildLodSelectionData(tree);
  // writeLodSplat never replaces a file, and the serialized bytes are what the tests need.
  const std::string path = tempPath("world-loader-tree.lodsplat");
  std::remove(path.c_str());
  EXPECT_TRUE(writeLodSplat(tree, path).ok());
  std::ifstream in(path, std::ios::binary);
  std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(in)),
                                  std::istreambuf_iterator<char>());
  std::remove(path.c_str());
  return bytes;
}

std::size_t nodeCountOf(const std::vector<std::uint8_t>& bytes) {
  return readLodSplatHeader(bytes.data(), bytes.size()).value().nodeCount;
}

// A labels.bin for `count` entries, labelling entry i with i % 256.
std::vector<std::uint8_t> labelBytes(std::size_t count) {
  std::vector<std::uint8_t> labels(count);
  for (std::size_t i = 0; i < count; ++i) labels[i] = static_cast<std::uint8_t>(i);
  return encodePartLabels(labels);
}

ByteView view(const std::vector<std::uint8_t>& bytes) {
  return {bytes.data(), bytes.size()};
}

std::string writeTemp(const std::string& name, const std::vector<std::uint8_t>& bytes) {
  const std::string path = tempPath(name);
  std::ofstream out(path, std::ios::binary);
  out.write(reinterpret_cast<const char*>(bytes.data()),
            static_cast<std::streamsize>(bytes.size()));
  return path;
}

TEST(SplatWorldLoader, NothingIsWaitingAtFirst) {
  SplatWorldLoader loader;
  EXPECT_FALSE(loader.hasWorld());
  EXPECT_EQ(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, TheTreeWaitsForTheRenderer) {
  SplatWorldLoader loader;
  const auto bytes = treeBytes(50);
  auto report = loader.loadWorld(view(bytes), {});
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_EQ(report.value().splatCount, 50u);
  EXPECT_EQ(report.value().nodeCount, nodeCountOf(bytes));
  EXPECT_GT(report.value().nodeCount, 50u);
  EXPECT_FALSE(report.value().labelled);
  EXPECT_TRUE(loader.hasWorld());

  auto tree = loader.takeWorld();
  ASSERT_NE(tree, nullptr);
  EXPECT_EQ(tree->leafCount, 50u);
  EXPECT_TRUE(tree->nodes.labels.empty());
  EXPECT_FALSE(loader.hasWorld());
  EXPECT_EQ(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, BadBytesFailAndLeaveTheWaitingWorld) {
  SplatWorldLoader loader;
  const auto bytes = treeBytes(10);
  ASSERT_TRUE(loader.loadWorld(view(bytes), {}).ok());
  const std::uint8_t junk[] = {1, 2, 3, 4, 5, 6, 7, 8};
  auto failed = loader.loadWorld({junk, sizeof(junk)}, {});
  ASSERT_FALSE(failed.ok());
  EXPECT_EQ(failed.error().code, ErrorCode::unsupportedFormat);
  EXPECT_NE(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, ANewerLoadReplacesTheWaitingOne) {
  SplatWorldLoader loader;
  const auto ten = treeBytes(10);
  const auto twenty = treeBytes(20);
  ASSERT_TRUE(loader.loadWorld(view(ten), {}).ok());
  ASSERT_TRUE(loader.loadWorld(view(twenty), {}).ok());
  auto tree = loader.takeWorld();
  ASSERT_NE(tree, nullptr);
  EXPECT_EQ(tree->leafCount, 20u);
  EXPECT_EQ(loader.takeWorld(), nullptr);
}

TEST(SplatWorldLoader, EachNodeTakesItsLabelInNodeOrder) {
  const auto bytes = treeBytes(200);
  const std::size_t nodes = nodeCountOf(bytes);
  SplatWorldLoader loader;
  auto report = loader.loadWorld(view(bytes), view(labelBytes(nodes)));
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_TRUE(report.value().labelled);
  const auto tree = loader.takeWorld();
  ASSERT_EQ(tree->nodes.labels.size(), nodes);
  for (std::size_t i = 0; i < nodes; ++i)
    ASSERT_EQ(tree->nodes.labels[i], static_cast<std::uint8_t>(i));
}

TEST(SplatWorldLoader, LabelsForAnotherTreeFailAndLeaveTheWaitingWorld) {
  SplatWorldLoader loader;
  const auto bytes = treeBytes(10);
  ASSERT_TRUE(loader.loadWorld(view(bytes), {}).ok());
  const std::size_t nodes = nodeCountOf(bytes);
  auto failed = loader.loadWorld(view(bytes), view(labelBytes(nodes + 1)));
  ASSERT_FALSE(failed.ok());
  EXPECT_EQ(failed.error().code, ErrorCode::labelsMismatch);
  EXPECT_EQ(failed.error().message, std::to_string(nodes + 1) + " part labels for " +
                                        std::to_string(nodes) + " tree nodes");
  auto tree = loader.takeWorld();
  ASSERT_NE(tree, nullptr);
  EXPECT_TRUE(tree->nodes.labels.empty());
}

TEST(SplatWorldLoader, LoadsAWorldAndItsLabelsFromFiles) {
  const auto bytes = treeBytes(30);
  const std::string world = writeTemp("world-loader-test.lodsplat", bytes);
  const std::string labels = writeTemp("world-loader-test.bin", labelBytes(nodeCountOf(bytes)));
  SplatWorldLoader loader;
  auto report = loader.loadWorldFile(world, labels);
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_EQ(report.value().splatCount, 30u);
  EXPECT_TRUE(report.value().labelled);
  ASSERT_NE(loader.takeWorld(), nullptr);

  report = loader.loadWorldFile(world, "");
  ASSERT_TRUE(report.ok()) << report.error().message;
  EXPECT_FALSE(report.value().labelled);
  ASSERT_NE(loader.takeWorld(), nullptr);

  auto missing = loader.loadWorldFile("/nonexistent/world.lodsplat", labels);
  ASSERT_FALSE(missing.ok());
  EXPECT_EQ(missing.error().code, ErrorCode::unreadable);
  missing = loader.loadWorldFile(world, "/nonexistent/labels.bin");
  ASSERT_FALSE(missing.ok());
  EXPECT_EQ(missing.error().code, ErrorCode::unreadable);
  EXPECT_EQ(loader.takeWorld(), nullptr);
  std::remove(world.c_str());
  std::remove(labels.c_str());
}

}  // namespace
}  // namespace splat

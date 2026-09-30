#include "splat/formats/PartLabels.h"

#include <vector>

#include <gtest/gtest.h>

namespace splat {
namespace {

// A header for `count` labels; the bytes after it are the caller's.
std::vector<std::uint8_t> header(std::uint32_t count) {
  return {'S', 'F', 'G', 'L',  // magic
          1,   0,              // version
          1,   0,              // bytes per label
          static_cast<std::uint8_t>(count), static_cast<std::uint8_t>(count >> 8),
          static_cast<std::uint8_t>(count >> 16), static_cast<std::uint8_t>(count >> 24),
          0,   0,   0,   0};  // reserved
}

std::vector<std::uint8_t> file(std::vector<std::uint8_t> labels) {
  auto bytes = header(static_cast<std::uint32_t>(labels.size()));
  bytes.insert(bytes.end(), labels.begin(), labels.end());
  return bytes;
}

Result<std::vector<std::uint8_t>> decode(const std::vector<std::uint8_t>& bytes) {
  return decodePartLabels(bytes.data(), bytes.size());
}

TEST(PartLabels, DecodesOneLabelPerSplat) {
  auto labels = decode(file({0, 3, 255, 7}));
  ASSERT_TRUE(labels.ok()) << labels.error().message;
  EXPECT_EQ(labels.value(), (std::vector<std::uint8_t>{0, 3, 255, 7}));
  // A cloud of 70,000 splats needs the count's upper bytes.
  labels = decode(file(std::vector<std::uint8_t>(70000, 2)));
  ASSERT_TRUE(labels.ok());
  EXPECT_EQ(labels.value().size(), 70000u);
  labels = decode(file({}));
  ASSERT_TRUE(labels.ok());
  EXPECT_TRUE(labels.value().empty());
}

TEST(PartLabels, RefusesAnotherFormat) {
  auto bytes = file({1, 2});
  bytes[0] = 'X';
  EXPECT_EQ(decode(bytes).error().code, ErrorCode::unsupportedFormat);
  bytes = file({1, 2});
  bytes[4] = 2;  // version 2
  EXPECT_EQ(decode(bytes).error().code, ErrorCode::unsupportedFormat);
  bytes = file({1, 2});
  bytes[6] = 2;  // two bytes per label
  EXPECT_EQ(decode(bytes).error().code, ErrorCode::unsupportedFormat);
  EXPECT_EQ(decode({'S', 'F', 'G'}).error().code, ErrorCode::unsupportedFormat);
  EXPECT_EQ(decodePartLabels(nullptr, 0).error().code, ErrorCode::unsupportedFormat);
}

TEST(PartLabels, RefusesASizeThatDisagreesWithTheCount) {
  auto bytes = file({1, 2, 3});
  bytes.pop_back();
  EXPECT_EQ(decode(bytes).error().code, ErrorCode::corrupt);
  bytes = file({1, 2, 3});
  bytes.push_back(4);
  EXPECT_EQ(decode(bytes).error().code, ErrorCode::corrupt);
  bytes = file({1, 2, 3});
  bytes[12] = 1;  // reserved
  EXPECT_EQ(decode(bytes).error().code, ErrorCode::corrupt);
}

}  // namespace
}  // namespace splat

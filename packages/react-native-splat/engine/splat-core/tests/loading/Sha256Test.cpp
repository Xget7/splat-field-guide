#include "../../src/loading/Sha256.h"

#include <array>
#include <string>
#include <vector>

#include <gtest/gtest.h>

namespace splat {
namespace {

TEST(Sha256, MatchesPublishedDigests) {
  const std::array<std::pair<std::string, std::string>, 3> vectors{{
      {"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
      {"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
      {std::string(1000000, 'a'), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"},
  }};
  for (const auto& [text, expected] : vectors) {
    const ByteView bytes{reinterpret_cast<const std::uint8_t*>(text.data()), text.size()};
    for (const bool hardware : {false, true}) {
      const auto digest = detail::sha256(bytes, hardware);
      ASSERT_TRUE(digest.ok());
      EXPECT_EQ(digest.value(), expected);
    }
  }
}

#if defined(SPLAT_CORE_ARM_SHA256)
TEST(Sha256, ArmAndPortableAgreeAcrossPaddingBoundariesAndUnalignedInput) {
  if (!detail::armSha256Available()) GTEST_SKIP() << "CPU lacks ARM SHA-256 instructions";
  std::vector<std::uint8_t> data(65539);
  for (std::size_t i = 0; i < data.size(); ++i) data[i] = static_cast<std::uint8_t>(i * 37);
  for (const std::size_t size : {0u, 1u, 55u, 56u, 63u, 64u, 65u, 119u, 120u, 127u,
                                128u, 129u, 4096u, 65536u, 65537u}) {
    const ByteView bytes{data.data() + 1, size};
    EXPECT_EQ(detail::sha256Arm(bytes), detail::sha256Portable(bytes)) << size;
    EXPECT_EQ(detail::sha256(bytes).value(), detail::sha256(bytes, false).value()) << size;
  }
}
#endif

}  // namespace
}  // namespace splat

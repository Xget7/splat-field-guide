#include "Sha256.h"

#include <algorithm>
#include <cstring>

#include <arm_neon.h>
#include "picosha2.h"

namespace splat::detail {
namespace {

constexpr std::size_t kBlockBytes = 64;
constexpr std::size_t kLengthBytes = 8;
const auto kRoundConstants = [] {
  std::array<std::uint32_t, 64> constants{};
  std::copy(std::begin(picosha2::detail::add_constant), std::end(picosha2::detail::add_constant),
            constants.begin());
  return constants;
}();

void processBlocks(std::uint32_t* state, const std::uint8_t* bytes, std::size_t count) {
  auto abcd = vld1q_u32(state);
  auto efgh = vld1q_u32(state + 4);
  for (std::size_t block = 0; block < count; ++block, bytes += kBlockBytes) {
    const auto savedAbcd = abcd;
    const auto savedEfgh = efgh;
    uint32x4_t words[4];
    for (int i = 0; i < 4; ++i)
      words[i] = vreinterpretq_u32_u8(vrev32q_u8(vld1q_u8(bytes + i * 16)));
    for (int round = 0; round < 16; ++round) {
      const auto index = round % 4;
      const auto message = vaddq_u32(words[index], vld1q_u32(kRoundConstants.data() + round * 4));
      const auto previousAbcd = abcd;
      abcd = vsha256hq_u32(abcd, efgh, message);
      efgh = vsha256h2q_u32(efgh, previousAbcd, message);
      if (round < 12)
        words[index] = vsha256su1q_u32(vsha256su0q_u32(words[index], words[(index + 1) % 4]),
                                      words[(index + 2) % 4], words[(index + 3) % 4]);
    }
    abcd = vaddq_u32(abcd, savedAbcd);
    efgh = vaddq_u32(efgh, savedEfgh);
  }
  vst1q_u32(state, abcd);
  vst1q_u32(state + 4, efgh);
}

}  // namespace

Sha256Digest sha256Arm(ByteView bytes) {
  std::uint32_t state[8];
  std::copy(std::begin(picosha2::detail::initial_message_digest),
            std::end(picosha2::detail::initial_message_digest), state);
  processBlocks(state, bytes.data, bytes.size / kBlockBytes);
  std::array<std::uint8_t, kBlockBytes * 2> tail{};
  const auto remainder = bytes.size % kBlockBytes;
  if (remainder != 0) std::memcpy(tail.data(), bytes.data + bytes.size - remainder, remainder);
  tail[remainder] = 0x80;
  const auto tailBytes = remainder < kBlockBytes - kLengthBytes ? kBlockBytes : kBlockBytes * 2;
  const auto bitLength = static_cast<std::uint64_t>(bytes.size) * 8;
  for (std::size_t i = 0; i < kLengthBytes; ++i)
    tail[tailBytes - 1 - i] = static_cast<std::uint8_t>(bitLength >> (i * 8));
  processBlocks(state, tail.data(), tailBytes / kBlockBytes);
  Sha256Digest digest;
  for (std::size_t i = 0; i < digest.size(); ++i)
    digest[i] = static_cast<std::uint8_t>(state[i / 4] >> (24 - (i % 4) * 8));
  return digest;
}

}  // namespace splat::detail

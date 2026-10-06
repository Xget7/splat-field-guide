#include "Sha256.h"

#include <algorithm>
#include <limits>

#if defined(SPLAT_CORE_ARM_SHA256)
#if defined(__APPLE__)
#include <sys/sysctl.h>
#else
#include <asm/hwcap.h>
#include <sys/auxv.h>
#endif
#endif

#if defined(SPLAT_CORE_PORTABLE_SHA256)
#include "picosha2.h"
#elif defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/evp.h>
#endif

namespace splat::detail {
namespace {

constexpr std::size_t kSha256Bytes = 32;
constexpr char kHexDigits[] = "0123456789abcdef";
#if defined(SPLAT_CORE_ARM_SHA256) && defined(__APPLE__)
constexpr char kArmSha256Feature[] = "hw.optional.arm.FEAT_SHA256";
#endif
#if !defined(SPLAT_CORE_PORTABLE_SHA256)
constexpr char kDigestFailed[] = "SHA-256 computation failed";
#endif

}

#if defined(SPLAT_CORE_PORTABLE_SHA256)
Sha256Digest sha256Portable(ByteView bytes) {
  constexpr std::size_t kHashChunkBytes = 64 * 1024;
  picosha2::hash256_one_by_one context;
  // PicoSHA2 copies each span, so bound its scratch buffer independently of pack size.
  for (std::size_t offset = 0; offset < bytes.size;) {
    const auto count = std::min(bytes.size - offset, kHashChunkBytes);
    context.process(bytes.data + offset, bytes.data + offset + count);
    offset += count;
  }
  context.finish();
  Sha256Digest digest;
  context.get_hash_bytes(digest.begin(), digest.end());
  return digest;
}
#endif

bool armSha256Available() {
#if defined(SPLAT_CORE_ARM_SHA256)
  static const bool available = [] {
#if defined(__APPLE__)
    int supported = 0;
    std::size_t size = sizeof(supported);
    return sysctlbyname(kArmSha256Feature, &supported, &size, nullptr, 0) == 0 &&
           supported != 0;
#else
    return (getauxval(AT_HWCAP) & HWCAP_SHA2) != 0;
#endif
  }();
  return available;
#else
  return false;
#endif
}

Result<std::string> sha256(ByteView bytes, [[maybe_unused]] bool allowHardware) {
  std::array<unsigned char, kSha256Bytes> digest;
#if defined(SPLAT_CORE_PORTABLE_SHA256)
#if defined(SPLAT_CORE_ARM_SHA256)
  if (allowHardware && armSha256Available()) digest = sha256Arm(bytes);
  else
#endif
    digest = sha256Portable(bytes);
#elif defined(__APPLE__)
  CC_SHA256_CTX context;
  if (CC_SHA256_Init(&context) != 1) return Error{ErrorCode::corrupt, kDigestFailed};
  for (std::size_t offset = 0; offset < bytes.size;) {
    const auto count = std::min(bytes.size - offset,
                                static_cast<std::size_t>(std::numeric_limits<CC_LONG>::max()));
    if (CC_SHA256_Update(&context, bytes.data + offset, static_cast<CC_LONG>(count)) != 1)
      return Error{ErrorCode::corrupt, kDigestFailed};
    offset += count;
  }
  if (CC_SHA256_Final(digest.data(), &context) != 1) return Error{ErrorCode::corrupt, kDigestFailed};
#else
  unsigned int size = 0;
  if (EVP_Digest(bytes.data, bytes.size, digest.data(), &size, EVP_sha256(), nullptr) != 1 ||
      size != kSha256Bytes) return Error{ErrorCode::corrupt, kDigestFailed};
#endif
  std::string hex;
  hex.reserve(kSha256Bytes * 2);
  for (const auto byte : digest) {
    hex.push_back(kHexDigits[byte >> 4]);
    hex.push_back(kHexDigits[byte & 0xf]);
  }
  return hex;
}

}

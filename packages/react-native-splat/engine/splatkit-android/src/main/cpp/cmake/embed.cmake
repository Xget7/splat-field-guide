# cmake -DINPUT=<file.spv> -DOUTPUT=<file.h> -DSYMBOL=<name> -P embed.cmake
file(READ "${INPUT}" hex HEX)
string(LENGTH "${hex}" hex_length)
math(EXPR word_count "${hex_length} / 8")
# SPIR-V is a stream of little-endian 32-bit words: regroup byte pairs accordingly.
string(REGEX REPLACE "(..)(..)(..)(..)" "0x\\4\\3\\2\\1," words "${hex}")
file(WRITE "${OUTPUT}" "// Generated from ${INPUT}. Do not edit.
#pragma once
#include <cstdint>
#include <cstddef>
namespace splatkit::shaders {
inline constexpr uint32_t ${SYMBOL}[] = { ${words} };
inline constexpr size_t ${SYMBOL}_size = sizeof(${SYMBOL});
}  // namespace splatkit::shaders
")

# Optimized Vulkan 1.1 module with camera reveal fields, compiled with the pinned NDK.
file(SHA256 "${INPUT}" actual)
set(expected "a73b5317b0cb42dd22b938b4efcacf579c4f5bc3c62ce4516ec31ef3bfce1d67")
if(NOT actual STREQUAL expected)
  message(FATAL_ERROR "Default visibility SPIR-V changed: ${actual}")
endif()

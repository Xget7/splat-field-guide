include(FetchContent)
# Archive timestamps from extraction time (CMake 3.24+); older CMake, like the Android SDK one, ignores this.
if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

# nianticlabs/spz's reference SPZ reader/writer is MIT-licensed; fresh extraction timestamps also
# apply to its zstd fetch.
set(CMAKE_POLICY_DEFAULT_CMP0135 NEW)
set(SPZ_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(SPZ_BUILD_PYTHON_BINDINGS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  spz
  GIT_REPOSITORY https://github.com/nianticlabs/spz.git
  GIT_TAG affd0ecea7fbb4c265ee119475af7ee5b2997482
  GIT_SHALLOW OFF
)
# The pinned zstd build supports CMake 3.10 policies, avoiding CMake 4's rejection of its older
# minimum.
set(CMAKE_POLICY_VERSION_MINIMUM 3.10)
FetchContent_MakeAvailable(spz)
unset(CMAKE_POLICY_VERSION_MINIMUM)

if(SPLAT_CORE_BUILD_TESTS)
  FetchContent_Declare(
    googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.tar.gz
    URL_HASH SHA256=7b42b4d6ed48810c5362c265a17faebe90dc2373c885e5216439d37927f02926
    )
  set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(googletest)
endif()

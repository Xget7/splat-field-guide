# SplatKit's splat_lod_build target, as upstream declares it; the other upstream tools are left out.
add_executable(splat_lod_build splat_lod_build.cpp)
target_link_libraries(splat_lod_build PRIVATE splat_core)
target_compile_options(splat_lod_build PRIVATE
  $<$<CXX_COMPILER_ID:GNU,Clang,AppleClang>:-Wall -Wextra -Wpedantic -Werror>
)

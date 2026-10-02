add_executable(splatkit_engine_tests
  camera/OrbitCameraTest.cpp
  diagnostics/StatsPublisherTest.cpp
  engine/SplatEngineTest.cpp
  highlight/HighlightTest.cpp
  reveal/RevealTest.cpp
  pick/PickIndexTest.cpp
  rendering/GpuLayoutTest.cpp
  sfg/SfgTest.cpp
)
# spz already reaches the link line through the static splat_core; only its headers are added
# here, so Apple's linker does not warn about the duplicate archive.
target_link_libraries(splatkit_engine_tests PRIVATE splatkit_engine GTest::gtest_main)
target_include_directories(splatkit_engine_tests PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR} $<TARGET_PROPERTY:spz,INTERFACE_INCLUDE_DIRECTORIES>)
target_compile_options(splatkit_engine_tests PRIVATE
  $<$<CXX_COMPILER_ID:GNU,Clang,AppleClang>:-Wall -Wextra -Wpedantic -Werror>
)
include(GoogleTest)
gtest_discover_tests(splatkit_engine_tests)

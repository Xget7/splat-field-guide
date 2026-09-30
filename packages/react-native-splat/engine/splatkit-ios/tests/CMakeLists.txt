add_executable(splatkit_ios_tests
  MetalRadixSortTest.mm
  MetalRasterTest.mm
  MetalVisibilityTest.mm
  MetalWorldTest.mm
  SfgMetalTest.mm
)
# The engine's test worlds, and spz's headers they write with.
target_include_directories(splatkit_ios_tests PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../Sources/SplatKitCore ${CMAKE_CURRENT_BINARY_DIR}/../embedded
  ${CMAKE_CURRENT_SOURCE_DIR}/../../splatkit-engine/tests
  $<TARGET_PROPERTY:spz,INTERFACE_INCLUDE_DIRECTORIES>
)
target_link_libraries(splatkit_ios_tests PRIVATE splatkit_ios GTest::gtest_main)
target_compile_options(splatkit_ios_tests PRIVATE -Wall -Wextra -Werror -fobjc-arc)
add_dependencies(splatkit_ios_tests splatkit_ios_shaders)
include(GoogleTest)
gtest_discover_tests(splatkit_ios_tests)

add_executable(splat_core_tests
  filtering/HazeTest.cpp
  filtering/SparseTest.cpp
  formats/PartLabelsTest.cpp
  formats/SpzDecoderTest.cpp
  io/MappedFileTest.cpp
  loading/SplatWorldLoaderTest.cpp
  math/HalfTest.cpp
  math/Mat4Test.cpp
  sorting/SpatialOrderTest.cpp
)
# spz already reaches the link line through the static splat_core; only its headers are added
# here, so Apple's linker does not warn about the duplicate archive.
target_link_libraries(splat_core_tests PRIVATE splat_core ZLIB::ZLIB GTest::gtest_main)
target_include_directories(splat_core_tests PRIVATE
  $<TARGET_PROPERTY:spz,INTERFACE_INCLUDE_DIRECTORIES>)
target_compile_definitions(splat_core_tests PRIVATE
  SPLAT_FIXTURES_DIR="${SPLAT_FIXTURES_DIR}"
)

include(GoogleTest)
gtest_discover_tests(splat_core_tests)

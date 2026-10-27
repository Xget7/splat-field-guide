add_executable(splat_core_tests
  filtering/HazeTest.cpp
  filtering/SparseTest.cpp
  formats/FrameTransformTest.cpp
  formats/PartLabelsTest.cpp
  formats/SplatDecoderTest.cpp
  formats/SpzDecoderTest.cpp
  io/MappedFileTest.cpp
  loading/Sha256Test.cpp
  loading/SplatWorldLoaderTest.cpp
  lod/LabelledLodTreeTest.cpp
  lod/LodTreeTest.cpp
  math/CovarianceTest.cpp
  math/HalfTest.cpp
  math/Mat4Test.cpp
  math/SymmetricEigenTest.cpp
)
# Only add spz headers because splat_core already links its archive, avoiding Apple's duplicate-archive warning.
target_link_libraries(splat_core_tests PRIVATE splat_core ZLIB::ZLIB GTest::gtest_main)
target_include_directories(splat_core_tests PRIVATE
  $<TARGET_PROPERTY:spz,INTERFACE_INCLUDE_DIRECTORIES>)
# spz's structs change with its extensions, so its headers need its definitions as well.
target_compile_definitions(splat_core_tests PRIVATE
  $<TARGET_PROPERTY:spz,INTERFACE_COMPILE_DEFINITIONS>
  SPLAT_FIXTURES_DIR="${SPLAT_FIXTURES_DIR}"
)
if(SPLAT_CORE_PORTABLE_SHA256)
  target_compile_definitions(splat_core_tests PRIVATE SPLAT_CORE_PORTABLE_SHA256)
endif()
if(SPLAT_CORE_ARM_SHA256)
  target_compile_definitions(splat_core_tests PRIVATE SPLAT_CORE_ARM_SHA256)
endif()

include(GoogleTest)
gtest_discover_tests(splat_core_tests)

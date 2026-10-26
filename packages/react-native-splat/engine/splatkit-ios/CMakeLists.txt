cmake_minimum_required(VERSION 3.22)
project(splatkit_ios LANGUAGES C CXX OBJCXX)

# For iOS, scripts/build-ios-engine.sh in the React Native package configures this with the
# iOS toolchain flags for devices and the simulator and packages the result as the
# XCFramework the pod vendors. On a Mac it builds the tests and tools.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# The Metal code runs on a Mac too, so its tests and tools are a macOS build of this package.
if(CMAKE_SYSTEM_NAME STREQUAL "iOS")
  set(SPLATKIT_IOS_BUILD_TESTS OFF)
  set(SPLATKIT_IOS_BUILD_TOOLS OFF)
else()
  option(SPLATKIT_IOS_BUILD_TESTS "Build splatkit_ios unit tests (macOS)" ${PROJECT_IS_TOP_LEVEL})
  option(SPLATKIT_IOS_BUILD_TOOLS "Build splat_snapshot (macOS)" ${PROJECT_IS_TOP_LEVEL})
endif()
set(SPLATKIT_ENGINE_BUILD_TESTS ${SPLATKIT_IOS_BUILD_TESTS} CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../splatkit-engine splatkit-engine)

# The Metal shader source travels inside the library as a string and is compiled by the
# device at start, so a host app needs no metallib of ours in its bundle.
include(cmake/embed.cmake)
set(SPLATKIT_METAL_DIR ${CMAKE_CURRENT_SOURCE_DIR}/Sources/SplatKitCore/rendering/metal)
splatkit_embed_text(splatkit_ios_shaders
  ${SPLATKIT_METAL_DIR}/device/Splat.metal
  SplatShaderSource
  ${SPLATKIT_METAL_DIR}
)

add_library(splatkit_ios STATIC
  Sources/SplatKitCore/rendering/metal/MetalSplatRenderer.mm
  Sources/SplatKitCore/rendering/metal/backdrop/MetalBackdrop.mm
  Sources/SplatKitCore/rendering/metal/cull/MetalVisibilityPass.mm
  Sources/SplatKitCore/rendering/metal/device/MetalContext.mm
  Sources/SplatKitCore/rendering/metal/diagnostics/MetalFrameCapture.mm
  Sources/SplatKitCore/rendering/metal/frame/MetalFrameCompute.mm
  Sources/SplatKitCore/rendering/metal/presentation/MetalFrameLoop.mm
  Sources/SplatKitCore/rendering/metal/presentation/MetalRenderTarget.mm
  Sources/SplatKitCore/rendering/metal/presentation/MetalSurface.mm
  Sources/SplatKitCore/rendering/metal/presentation/MetalUpscaler.mm
  Sources/SplatKitCore/rendering/metal/raster/MetalSplatPipeline.mm
  Sources/SplatKitCore/rendering/metal/selection/MetalLodSelection.mm
  Sources/SplatKitCore/rendering/metal/sort/MetalRadixSort.mm
  Sources/SplatKitCore/rendering/metal/world/MetalWorld.mm
  Sources/SplatKitCore/sfg/sfg_metal.mm
)
target_include_directories(splatkit_ios
  PUBLIC Sources/SplatKitCore Sources/SplatKitCore/include
  PRIVATE ${CMAKE_CURRENT_BINARY_DIR}/embedded
)
target_compile_options(splatkit_ios PRIVATE -Wall -Wextra -Werror -fobjc-arc)
target_link_libraries(splatkit_ios PUBLIC splatkit_engine
  "-framework Metal" "-framework QuartzCore" "-framework Foundation"
  "-framework CoreGraphics" "-framework ImageIO" "-framework UniformTypeIdentifiers")
# The iOS simulator SDK has no MetalFX; MetalUpscaler compiles the scaler out via __has_include.
find_library(SPLATKIT_METALFX_FRAMEWORK MetalFX)
if(SPLATKIT_METALFX_FRAMEWORK)
  target_link_libraries(splatkit_ios PUBLIC "-framework MetalFX")
endif()
add_dependencies(splatkit_ios splatkit_ios_shaders)

if(SPLATKIT_IOS_BUILD_TOOLS)
  add_executable(splat_snapshot tools/splat_snapshot.mm)
  target_link_libraries(splat_snapshot PRIVATE splatkit_ios)
  target_compile_options(splat_snapshot PRIVATE -Wall -Wextra -Werror -fobjc-arc)
endif()

if(SPLATKIT_IOS_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

cmake_minimum_required(VERSION 3.22)
project(splatkit LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# Everything links into the shared libsplatkit.so, fetched static libraries included.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(FetchContent)

# vk-bootstrap: instance, device and swapchain creation without the boilerplate (MIT).
# Its own option overrides CMAKE_POSITION_INDEPENDENT_CODE, so set it explicitly.
set(VK_BOOTSTRAP_POSITION_INDEPENDENT_CODE ON CACHE BOOL "" FORCE)
FetchContent_Declare(
  vk-bootstrap
  GIT_REPOSITORY https://github.com/charles-lunarg/vk-bootstrap.git
  GIT_TAG v1.4.307
)
# VulkanMemoryAllocator: buffer and image memory (MIT).
FetchContent_Declare(
  VulkanMemoryAllocator
  GIT_REPOSITORY https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator.git
  GIT_TAG v3.2.1
)
FetchContent_MakeAvailable(vk-bootstrap VulkanMemoryAllocator)

option(SPLATKIT_VULKAN_SH8 "Use experimental 8-bit spherical harmonics storage" OFF)
# Upload, descriptor bounds and shaders must agree on the storage format.
add_compile_definitions(SPLATKIT_VULKAN_SH8=$<BOOL:${SPLATKIT_VULKAN_SH8}>)

set(SPLATKIT_ENGINE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../../splatkit-engine splatkit-engine)

include(cmake/shaders.cmake)
splatkit_compile_shaders(splatkit_shaders
  rendering/vulkan/raster/splat.vert
  rendering/vulkan/raster/projected.vert
  rendering/vulkan/raster/splat.frag
  rendering/vulkan/cull/labelled_visibility.comp
  rendering/vulkan/cull/visibility.comp
  rendering/vulkan/cull/prepare_indirect.comp
  rendering/vulkan/selection/lod_selection.comp
  rendering/vulkan/sort/radix_prepare.comp
  rendering/vulkan/sort/radix_histogram.comp
  rendering/vulkan/sort/radix_scan.comp
  rendering/vulkan/sort/radix_scatter.comp
)

add_library(splatkit_vulkan STATIC
  rendering/vulkan/device/VulkanContext.cpp
  rendering/vulkan/presentation/VulkanSurface.cpp
  rendering/vulkan/presentation/VulkanSwapchain.cpp
  rendering/vulkan/presentation/VulkanRenderTarget.cpp
  rendering/vulkan/presentation/VulkanFrameLoop.cpp
  rendering/vulkan/device/VulkanBuffer.cpp
  rendering/vulkan/device/VulkanPipelineCache.cpp
  rendering/vulkan/world/VulkanWorld.cpp
  rendering/vulkan/raster/VulkanSplatPipeline.cpp
  rendering/vulkan/cull/VulkanVisibilityPass.cpp
  rendering/vulkan/selection/VulkanLodSelection.cpp
  rendering/vulkan/sort/VulkanRadixSort.cpp
  rendering/vulkan/frame/VulkanFrameCompute.cpp
  rendering/vulkan/frame/VulkanCameraUniforms.cpp
  rendering/vulkan/VulkanSplatRenderer.cpp
  rendering/vulkan/device/Vma.cpp
)
add_library(splatkit SHARED
  engine/AndroidEngine.cpp
  jni/JniConversions.cpp
  jni/SplatKitJni.cpp
)
target_include_directories(splatkit PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(splatkit_vulkan PUBLIC include PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(splatkit_vulkan PUBLIC VK_USE_PLATFORM_ANDROID_KHR
  SPLATKIT_VULKAN_SH8=$<BOOL:${SPLATKIT_VULKAN_SH8}>)
# Vulkan structs are initialised as `{VK_STRUCTURE_TYPE_...}`; the rest is zero on purpose.
target_compile_options(splatkit_vulkan PRIVATE
  -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)
# Third party headers are not held to our warning level.
get_target_property(vma_include GPUOpen::VulkanMemoryAllocator INTERFACE_INCLUDE_DIRECTORIES)
get_target_property(vkb_include vk-bootstrap::vk-bootstrap INTERFACE_INCLUDE_DIRECTORIES)
target_include_directories(splatkit_vulkan SYSTEM PRIVATE ${vma_include} ${vkb_include})
# Hide everything the JVM does not call. See splatkit.map.
target_compile_options(splatkit PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter
  -Wno-missing-field-initializers -fvisibility=hidden -fvisibility-inlines-hidden)
target_link_options(splatkit PRIVATE
  # NDK r27 requires explicit 16 KB alignment, including direct CMake builds.
  "-Wl,-z,max-page-size=16384"
  "-Wl,-z,common-page-size=16384"
  "-Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/splatkit.map"
  "-Wl,--exclude-libs,ALL"
)
target_link_libraries(splatkit PRIVATE splatkit_vulkan)
target_link_libraries(splatkit_vulkan PUBLIC splatkit_engine
  PRIVATE
  splatkit_shaders
  vk-bootstrap::vk-bootstrap
  GPUOpen::VulkanMemoryAllocator
  vulkan
  android
  log
)

option(SPLATKIT_ANDROID_BUILD_TESTS "Build no-surface Vulkan tests (run through adb)" OFF)
if(SPLATKIT_ANDROID_BUILD_TESTS)
  set(SPLATKIT_ANDROID_CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR})
  add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../../../tests tests)
endif()

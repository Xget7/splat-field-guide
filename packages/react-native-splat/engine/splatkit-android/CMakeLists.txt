cmake_minimum_required(VERSION 3.22)
project(splatkit_android LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# The viewer and its dependencies need optimisation even when React Native is debuggable.
add_compile_options(-O3)
include(FetchContent)
set(VK_BOOTSTRAP_POSITION_INDEPENDENT_CODE ON CACHE BOOL "" FORCE)
FetchContent_Declare(vk-bootstrap
  GIT_REPOSITORY https://github.com/charles-lunarg/vk-bootstrap.git GIT_TAG v1.4.307)
FetchContent_Declare(VulkanMemoryAllocator
  GIT_REPOSITORY https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator.git GIT_TAG v3.2.1)
FetchContent_MakeAvailable(vk-bootstrap VulkanMemoryAllocator)
add_subdirectory(../splatkit-engine splatkit-engine)
include(cmake/shaders.cmake)
splatkit_compile_shaders(splatkit_shaders
  rendering/vulkan/raster/projected.vert
  rendering/vulkan/raster/splat.frag
  rendering/vulkan/cull/visibility.comp
  rendering/vulkan/cull/prepare_indirect.comp
  rendering/vulkan/selection/lod_selection.comp
  rendering/vulkan/sort/radix_prepare.comp
  rendering/vulkan/sort/radix_histogram.comp
  rendering/vulkan/sort/radix_scan.comp
  rendering/vulkan/sort/radix_scatter.comp)
add_library(splatkit_android STATIC
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
  sfg_vulkan.cpp)
target_include_directories(splatkit_android PUBLIC include PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(splatkit_android PRIVATE VK_USE_PLATFORM_ANDROID_KHR)
target_compile_options(splatkit_android PRIVATE -Wall -Wextra -Werror
  -Wno-unused-parameter -Wno-missing-field-initializers)
get_target_property(vma_include GPUOpen::VulkanMemoryAllocator INTERFACE_INCLUDE_DIRECTORIES)
get_target_property(vkb_include vk-bootstrap::vk-bootstrap INTERFACE_INCLUDE_DIRECTORIES)
target_include_directories(splatkit_android SYSTEM PRIVATE ${vma_include} ${vkb_include})
target_link_libraries(splatkit_android PUBLIC splatkit_engine PRIVATE splatkit_shaders
  vk-bootstrap::vk-bootstrap GPUOpen::VulkanMemoryAllocator vulkan android log)

# Upstream's no-surface Vulkan tests, built as executables and run on a device through adb.
option(SPLATKIT_ANDROID_BUILD_TESTS "Build no-surface Vulkan tests (run through adb)" OFF)
if(SPLATKIT_ANDROID_BUILD_TESTS)
  set(SPLATKIT_ANDROID_CPP_DIR ${CMAKE_CURRENT_SOURCE_DIR})
  add_subdirectory(tests)
endif()

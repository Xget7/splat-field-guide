cmake_minimum_required(VERSION 3.22)
project(splatkit_android LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
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
  shaders/splat.vert shaders/splat.frag shaders/visibility.comp shaders/prepare_indirect.comp
  shaders/radix_prepare.comp shaders/radix_histogram.comp shaders/radix_scan.comp shaders/radix_scatter.comp)
add_library(splatkit_android STATIC
  rendering/vulkan/VulkanContext.cpp rendering/vulkan/Swapchain.cpp
  rendering/vulkan/RenderTarget.cpp rendering/vulkan/FrameLoop.cpp rendering/vulkan/GpuBuffer.cpp
  rendering/vulkan/SplatPipeline.cpp rendering/vulkan/VisibilityPass.cpp
  rendering/vulkan/RadixSort.cpp rendering/vulkan/VulkanFrameCompute.cpp
  rendering/vulkan/VulkanSplatRenderer.cpp rendering/vulkan/Vma.cpp sfg_vulkan.cpp)
target_include_directories(splatkit_android PUBLIC include PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(splatkit_android PRIVATE VK_USE_PLATFORM_ANDROID_KHR)
target_compile_options(splatkit_android PRIVATE -Wall -Wextra -Werror
  -Wno-unused-parameter -Wno-missing-field-initializers)
get_target_property(vma_include GPUOpen::VulkanMemoryAllocator INTERFACE_INCLUDE_DIRECTORIES)
get_target_property(vkb_include vk-bootstrap::vk-bootstrap INTERFACE_INCLUDE_DIRECTORIES)
target_include_directories(splatkit_android SYSTEM PRIVATE ${vma_include} ${vkb_include})
target_link_libraries(splatkit_android PUBLIC splatkit_engine PRIVATE splatkit_shaders
  vk-bootstrap::vk-bootstrap GPUOpen::VulkanMemoryAllocator vulkan android log)

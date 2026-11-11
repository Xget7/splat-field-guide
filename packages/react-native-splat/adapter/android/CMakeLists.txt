cmake_minimum_required(VERSION 3.22)
project(sfg_vulkan LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(vulkan_source "${CMAKE_CURRENT_SOURCE_DIR}/../../engine/splatkit-android/src/main/cpp")
# Reuse upstream dependency pins and shader generation, but not its Kotlin JNI facade.
# The SDK shared library hides C++ symbols, so compile its renderer into our own adapter.
add_subdirectory("${vulkan_source}" splatkit-android EXCLUDE_FROM_ALL)
get_target_property(sdk_sources splatkit SOURCES)
set(renderer_sources)
foreach(source IN LISTS sdk_sources)
  if(source MATCHES "^rendering/")
    list(APPEND renderer_sources "${vulkan_source}/${source}")
  endif()
endforeach()
add_subdirectory(.. sfg-adapter)
add_library(sfg_vulkan STATIC sfg_vulkan.cpp ${renderer_sources})
target_include_directories(sfg_vulkan PUBLIC include PRIVATE "${vulkan_source}")
# Vendor headers do not carry the adapter's Clang nullability annotations.
get_target_property(vma_include GPUOpen::VulkanMemoryAllocator INTERFACE_INCLUDE_DIRECTORIES)
get_target_property(vkb_include vk-bootstrap::vk-bootstrap INTERFACE_INCLUDE_DIRECTORIES)
target_include_directories(sfg_vulkan SYSTEM PRIVATE ${vma_include} ${vkb_include})
target_compile_definitions(sfg_vulkan PRIVATE VK_USE_PLATFORM_ANDROID_KHR
  SPLATKIT_VULKAN_SH8=$<BOOL:${SPLATKIT_VULKAN_SH8}>)
target_link_libraries(sfg_vulkan PUBLIC sfg_adapter PRIVATE
  splatkit_shaders vk-bootstrap::vk-bootstrap GPUOpen::VulkanMemoryAllocator
  vulkan android log)

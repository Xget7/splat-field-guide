# Included by ../CMakeLists.txt, which sets SPLATKIT_ANDROID_CPP_DIR, vma_include and vkb_include.
set(vulkan_source_dir ${SPLATKIT_ANDROID_CPP_DIR}/rendering/vulkan)

add_library(splatkit_vulkan_test_support STATIC
  ${vulkan_source_dir}/device/VulkanContext.cpp
  ${vulkan_source_dir}/device/VulkanBuffer.cpp
  ${vulkan_source_dir}/device/VulkanPipelineCache.cpp
  ${vulkan_source_dir}/device/Vma.cpp
)
target_include_directories(splatkit_vulkan_test_support PUBLIC ${SPLATKIT_ANDROID_CPP_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR})
target_include_directories(splatkit_vulkan_test_support SYSTEM PUBLIC ${vma_include} ${vkb_include})
target_compile_definitions(splatkit_vulkan_test_support PUBLIC VK_USE_PLATFORM_ANDROID_KHR)
target_compile_options(splatkit_vulkan_test_support PRIVATE
  -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)
target_link_libraries(splatkit_vulkan_test_support PUBLIC
  splatkit_engine vk-bootstrap::vk-bootstrap GPUOpen::VulkanMemoryAllocator vulkan android log)

add_executable(splatkit_vulkan_context_test rendering/vulkan/device/VulkanContextTest.cpp)
target_link_libraries(splatkit_vulkan_context_test PRIVATE splatkit_vulkan_test_support)
add_executable(splatkit_vulkan_pipeline_cache_test
  rendering/vulkan/device/VulkanPipelineCacheTest.cpp)
target_link_libraries(splatkit_vulkan_pipeline_cache_test PRIVATE
  splatkit_vulkan_test_support splatkit_shaders)
add_executable(splatkit_vulkan_buffer_test rendering/vulkan/device/VulkanBufferTest.cpp)
target_link_libraries(splatkit_vulkan_buffer_test PRIVATE splatkit_vulkan_test_support)
add_executable(splatkit_vulkan_upload_pressure_test rendering/vulkan/device/VulkanUploadPressureTest.cpp)
target_link_libraries(splatkit_vulkan_upload_pressure_test PRIVATE splatkit_vulkan_test_support)
add_executable(splatkit_vulkan_world_test rendering/vulkan/world/VulkanWorldTest.cpp
  ${vulkan_source_dir}/world/VulkanWorld.cpp)
target_link_libraries(splatkit_vulkan_world_test PRIVATE splatkit_vulkan_test_support)
add_executable(splatkit_vulkan_lod_selection_test rendering/vulkan/selection/VulkanLodSelectionTest.cpp
  ${vulkan_source_dir}/selection/VulkanLodSelection.cpp)
target_link_libraries(splatkit_vulkan_lod_selection_test PRIVATE
  splatkit_vulkan_test_support splatkit_shaders)
add_executable(splatkit_vulkan_visibility_pass_test rendering/vulkan/cull/VulkanVisibilityPassTest.cpp
  ${vulkan_source_dir}/cull/VulkanVisibilityPass.cpp)
target_link_libraries(splatkit_vulkan_visibility_pass_test PRIVATE
  splatkit_vulkan_test_support splatkit_shaders)
add_executable(splatkit_vulkan_frame_compute_test rendering/vulkan/frame/VulkanFrameComputeTest.cpp
  ${vulkan_source_dir}/frame/VulkanFrameCompute.cpp ${vulkan_source_dir}/selection/VulkanLodSelection.cpp
  ${vulkan_source_dir}/cull/VulkanVisibilityPass.cpp ${vulkan_source_dir}/sort/VulkanRadixSort.cpp)
target_link_libraries(splatkit_vulkan_frame_compute_test PRIVATE
  splatkit_vulkan_test_support splatkit_shaders)
add_executable(splatkit_vulkan_radix_sort_test rendering/vulkan/sort/VulkanRadixSortTest.cpp
  ${vulkan_source_dir}/sort/VulkanRadixSort.cpp)
target_link_libraries(splatkit_vulkan_radix_sort_test PRIVATE
  splatkit_vulkan_test_support splatkit_shaders)
add_executable(splatkit_vulkan_splat_pipeline_test rendering/vulkan/raster/VulkanSplatPipelineTest.cpp
  ${vulkan_source_dir}/raster/VulkanSplatPipeline.cpp ${vulkan_source_dir}/world/VulkanWorld.cpp
  ${vulkan_source_dir}/frame/VulkanCameraUniforms.cpp
  ${vulkan_source_dir}/presentation/VulkanRenderTarget.cpp)
target_link_libraries(splatkit_vulkan_splat_pipeline_test PRIVATE
  splatkit_vulkan_test_support splatkit_shaders)

# Building this target links every device test; scripts/lint-cpp.sh does so in CI.
add_custom_target(splatkit_android_tests DEPENDS
  splatkit_vulkan_context_test
  splatkit_vulkan_pipeline_cache_test
  splatkit_vulkan_buffer_test
  splatkit_vulkan_upload_pressure_test
  splatkit_vulkan_world_test
  splatkit_vulkan_lod_selection_test
  splatkit_vulkan_visibility_pass_test
  splatkit_vulkan_frame_compute_test
  splatkit_vulkan_radix_sort_test
  splatkit_vulkan_splat_pipeline_test
)

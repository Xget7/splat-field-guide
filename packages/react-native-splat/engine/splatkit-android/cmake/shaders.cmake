# Embed NDK-compiled SPIR-V in the native library so runtime shader asset loading is unnecessary.

function(splatkit_compile_shaders target)
  if(NOT DEFINED ANDROID_NDK OR NOT DEFINED ANDROID_HOST_TAG)
    message(FATAL_ERROR "splatkit_compile_shaders needs the NDK toolchain")
  endif()
  set(glslc "${ANDROID_NDK}/shader-tools/${ANDROID_HOST_TAG}/glslc")
  set(out_dir "${CMAKE_CURRENT_BINARY_DIR}/generated/shaders")
  file(MAKE_DIRECTORY "${out_dir}")

  set(headers)
  foreach(source IN LISTS ARGN)
    get_filename_component(name "${source}" NAME)
    string(REPLACE "." "_" symbol "${name}")
    set(spv "${out_dir}/${name}.spv")
    set(header "${out_dir}/${symbol}.h")
    add_custom_command(
      OUTPUT "${spv}"
      COMMAND "${glslc}" -O --target-env=vulkan1.1 -o "${spv}" "${CMAKE_CURRENT_SOURCE_DIR}/${source}"
      DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/${source}"
      COMMENT "glslc ${source}"
      VERBATIM
    )
    add_custom_command(
      OUTPUT "${header}"
      COMMAND "${CMAKE_COMMAND}"
        "-DINPUT=${spv}" "-DOUTPUT=${header}" "-DSYMBOL=${symbol}"
        -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed.cmake"
      DEPENDS "${spv}" "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed.cmake"
      COMMENT "embed ${name}"
      VERBATIM
    )
    list(APPEND headers "${header}")
  endforeach()

  add_custom_target(${target}_generate DEPENDS ${headers})
  add_library(${target} INTERFACE)
  add_dependencies(${target} ${target}_generate)
  target_include_directories(${target} INTERFACE "${CMAKE_CURRENT_BINARY_DIR}/generated")
endfunction()

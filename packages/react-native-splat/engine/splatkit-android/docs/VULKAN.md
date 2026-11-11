# Vulkan

Public API: `SplatSurfaceView`; JNI and Vulkan classes are internal.
Current source enables `VulkanFrameCompute`: GPU LOD → visibility → stable radix → indirect draw.
Alpha06 fixes Adreno histogram corruption in alpha05; Maven alpha04 predates GPU ordering.
Per-view `sortDepth`, `lodErrorPixels`, `lodSplatLimit` and `subpixelThreshold` apply through `applyRenderPolicy`, which the React Native `policy` prop drives.

Contracts live beside code: [VulkanVisibilityPass.h](../src/main/cpp/rendering/vulkan/cull/VulkanVisibilityPass.h), [shader ABI](../src/main/cpp/rendering/vulkan/layout/VulkanShaderTypes.h).
The context outlives allocations; reuse slots after fences, resize/destroy after all consumers finish.
The caller owns input sizes, alignment, upload dependencies and readback invalidation.
Unsorted output requires sorting before drawing.
Subgroup width is device-dependent; subpixel rejection is approximate.
Visibility scratch: `80*capacity+64` bytes across two slots, a key, a value and a 32-byte `ProjectedSplat` per splat; radix adds ~132MB at 4M.
Source capacity obeys `maxStorageBufferRange/32`; 10M is not guaranteed.
Survivor overflow above 4M zeros the draw with diagnostics; it never silently truncates.
16-bit sorting is the default: two passes on quantized keys stored in `uint32`, without requiring native 16-bit arithmetic/storage.
A per-instance `sortDepth` of 32 preserves float-depth keys in four passes.

Evidence (2026-09-12): Android arm64 emulator / M4 Pro via MoltenVK passed 128 radix cases through 3M, visibility, LOD-to-indirect integration and shader-free upload pressure; native suites had layers off.
Kitchen 500k loaded/drew with layers on and no captured validation errors.
SwiftShader passes smaller suites but crashes on large mapped uploads, also reproduced without SDK code.
No physical Android performance or reference-image quality acceptance follows.

Physical Mi 9 / Adreno 640, Vulkan 1.1.128, driver 0x801f6000: alpha05 ballot grouping repeatedly lost duplicate keys at 31 inputs.
Workgroup-local atomic histogram fixes this without global atomics.
Alpha06 passes 152 stable-sort cases through 3M (including 63/64/65 tails), visibility, LOD, complete indirect ordering and upload-pressure tests; standalone layers were off.
Kitchen 500k and house 2M render with app validation on; background/resume also passed.
This is device correctness evidence, not lossless LOD or universal FPS acceptance.
2026-09-16, same device: buffer, upload-pressure, LOD, visibility, radix (144 cases; 3M skipped) and frame-compute suites passed, frame compute at 16 and 32 bits through `applyRenderPolicy`.
2026-10-20, same device: all nine suites passed with the 4M radix (152 cases) and 4M upload-pressure cases.

Mi 9 house 2M, SH0, 1080x2261, Release, 30-second turns:

| Configuration | Mean FPS | GPU ms | Visibility ms* |
|---|---:|---:|---:|
| Full source | 19.2 | 51.9 | unavailable |
| LOD before empty-group skip | 24.0 | 41.6 | 19.15 |
| Same LOD, empty groups skipped (two runs) | 41.4 | 23.9 | 1.81 |

*Stage means use ~2-second samples.
Sort stayed ~3.18 ms; source 2M, drawn ~45k–125k.
LOD quality/resolution were unchanged by this optimization.
PSS snapshot: ~566 MiB.
[Settings, hashes and measurements](../../../docs/benchmarks/2026-09-12-mi9-vulkan.json).

## SH storage experiment

`SPLATKIT_VULKAN_SH8` is a build option that defaults off.
From `apps/android-dev`, use `./gradlew :app:assembleRelease -PsplatkitVulkanSh8=true`; `false` restores half-SH storage.
Direct CMake builds and native tests use `-DSPLATKIT_VULKAN_SH8=ON`.
Upload, descriptor ranges and shader decoding share the [scaled format](../../splatkit-engine/include/splatkit/rendering/GpuLayout.h), including streamed tiles.
Degree 0 has no SH payload; degree 1 saves 4 bytes per splat and degree 3 saves 40, excluding other GPU buffers.
The shared load-memory guard still estimates half-SH storage conservatively.
Quantization is lossy; general visual and FPS acceptance remain unvalidated.

## Metal mapping

| Metal | Vulkan / GLSL |
|---|---|
| `threadgroup` memory | `shared` / SPIR-V Workgroup; not framebuffer tile memory (GMEM) |
| `simd_prefix_exclusive_sum`, `simd_sum` | `subgroupExclusiveAdd`, `subgroupAdd`; query subgroup capabilities/width |
| `threadgroup_position_in_grid` | `gl_WorkGroupID`; `local_size` specifies group dimensions instead |
| `device T*` buffer | Storage-buffer descriptor + `VK_BUFFER_USAGE_STORAGE_BUFFER_BIT` |

References: [subgroups](https://docs.vulkan.org/guide/latest/subgroups.html), [built-ins](https://docs.vulkan.org/glsl/latest/chapters/builtins.html), [16-bit arithmetic/storage](https://docs.vulkan.org/samples/latest/samples/performance/16bit_arithmetic/README.html).

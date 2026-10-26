#pragma once

#include <android/native_window.h>
#include "splatkit/sfg.h"

#ifdef __cplusplus
extern "C" {
#endif

// Pointers not marked nullable are non-null, as in sfg.h.
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wnullability-extension"
#pragma clang assume_nonnull begin
#endif

// `cacheDir` is a writable directory for the persistent Vulkan pipeline cache, so a later
// launch compiles nothing; null disables the cache. Null when Vulkan is unavailable.
sfg_engine* SFG_NULLABLE sfg_vulkan_create(const char* SFG_NULLABLE cacheDir);
void sfg_vulkan_set_window(sfg_engine* engine, ANativeWindow* SFG_NULLABLE window);
void sfg_vulkan_resize(sfg_engine* engine, uint32_t width, uint32_t height);

#if defined(__clang__)
#pragma clang assume_nonnull end
#pragma clang diagnostic pop
#endif

#ifdef __cplusplus
}
#endif

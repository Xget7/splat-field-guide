#pragma once

#include <android/native_window.h>
#include "splatkit/sfg.h"

#ifdef __cplusplus
extern "C" {
#endif
sfg_engine* sfg_vulkan_create(void);
void sfg_vulkan_set_window(sfg_engine* engine, ANativeWindow* window);
void sfg_vulkan_resize(sfg_engine* engine, uint32_t width, uint32_t height);
#ifdef __cplusplus
}
#endif

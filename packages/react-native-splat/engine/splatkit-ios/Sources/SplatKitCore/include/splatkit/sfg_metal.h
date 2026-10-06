#pragma once

#import <QuartzCore/CAMetalLayer.h>

#include "splatkit/sfg.h"

// The engine of sfg.h over Metal, for the iOS view. Render thread.

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

// A new engine, or NULL when the device has no Metal GPU of Apple family 7 or later (A14, M1).
sfg_engine* _Nullable sfg_metal_create(void);
// Attaching a layer or nil waits for GPU use of the previous layer to finish.
void sfg_metal_set_layer(sfg_engine* engine, CAMetalLayer* _Nullable layer);
// The layer's drawable size, in pixels.
void sfg_metal_set_drawable_size(sfg_engine* engine, uint32_t width, uint32_t height);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END

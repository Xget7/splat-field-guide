#pragma once

#import <Metal/Metal.h>

namespace splatkit {

// Field Guide's buffer slots in the passes that project splats, past every slot upstream
// SplatKit binds there, so its own kernels keep their indices across a sync. The shader library
// receives them as the SPLAT_GUIDE_LABELS_BUFFER and SPLAT_GUIDE_BUFFER macros.
// The label stream: one byte per splat, in the world's splat order.
inline constexpr NSUInteger kGuideLabelsBuffer = 12;
// The GuideUniform of the frame: the reveal and one style per label.
inline constexpr NSUInteger kGuideBuffer = 13;

}  // namespace splatkit

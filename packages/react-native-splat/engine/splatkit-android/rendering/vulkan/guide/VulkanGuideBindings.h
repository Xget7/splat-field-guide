// Field Guide's bindings in set 0 of the visibility pass, past the ten upstream SplatKit uses
// there, so its own shader keeps its bindings across a sync. GLSL needs literal binding numbers,
// so guide_style.glsl includes this file too and the macros are the one source of both.
#ifndef SPLATKIT_VULKAN_GUIDE_BINDINGS_H
#define SPLATKIT_VULKAN_GUIDE_BINDINGS_H

// The label stream: one byte per splat in the world's splat order, read as uint words.
#define SPLAT_GUIDE_LABELS_BINDING 10
// The GuideUniform of the frame: the reveal and one style per label.
#define SPLAT_GUIDE_BINDING 11

#ifdef __cplusplus
#include <cstdint>

namespace splatkit {

inline constexpr uint32_t kGuideLabelsBinding = SPLAT_GUIDE_LABELS_BINDING;
inline constexpr uint32_t kGuideBinding = SPLAT_GUIDE_BINDING;

}  // namespace splatkit
#endif

#endif

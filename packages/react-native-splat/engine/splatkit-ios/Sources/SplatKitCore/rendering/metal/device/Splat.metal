// One library, with each stage maintained in its own source file.
#include "../raster/SplatRaster.metal"
#include "../cull/SplatVisibility.metal"
#include "../cull/PrepareIndirect.metalh"
#include "../sort/SplatRadixSort.metal"
#include "../selection/SplatLOD.metal"
// Field Guide: the part styles and reveal the projection applies, and the backdrop.
#include "../guide/GuideStyle.metalh"
#include "../backdrop/SplatBackdrop.metal"

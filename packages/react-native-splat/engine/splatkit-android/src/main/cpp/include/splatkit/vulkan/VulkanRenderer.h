#pragma once

#include <memory>
#include <string>
#include "splat/core/Result.h"
#include "splatkit/rendering/SplatRenderer.h"

struct ANativeWindow;

namespace splatkit {

// Render-thread API. Transfer ownership to SplatEngine and keep a borrowed pointer
// for surface operations only while that engine lives.
class VulkanRenderer : public SplatRenderer {
 public:
  // Empty path keeps the pipeline cache in memory. Device failures return an error.
  static splat::Result<std::unique_ptr<VulkanRenderer>> create(std::string pipelineCachePath = {});
  // Retains the window; nullptr detaches it without discarding the world.
  virtual void setWindow(ANativeWindow* window) = 0;
  virtual void onSurfaceResized(uint32_t width, uint32_t height) = 0;
  // Refresh completed GPU statistics before sampling them on an idle frame.
  virtual void collectCompletedFrames() = 0;
};

}  // namespace splatkit

#pragma once
#include <atomic>
#include <optional>
#include "splatkit/Log.h"
#include "splatkit/engine/SplatEngine.h"
namespace splatkit {
inline std::optional<int> publicEvent(SplatEngine::Event event) {
  switch (event) {
    case SplatEngine::Event::worldReady:
      return 0;
    case SplatEngine::Event::worldFailed:
    // Platform hosts receive mismatched labels as a failed world; the message names the cause.
    case SplatEngine::Event::labelsMismatch:
      return 1;
    case SplatEngine::Event::colliderReady:
      return 2;
    case SplatEngine::Event::colliderFailed:
      return 3;
    case SplatEngine::Event::gpuFailed:
      return 5;
    // The adapter emits readiness only after GPU completion.
    case SplatEngine::Event::worldFrameReady:
      return std::nullopt;
  }
  static std::atomic<bool> logged{false};
  if (!logged.exchange(true)) LOGE("Unknown engine event dropped");
  return std::nullopt;
}
}  // namespace splatkit

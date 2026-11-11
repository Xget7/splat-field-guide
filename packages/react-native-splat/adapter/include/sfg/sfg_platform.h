#pragma once
#include <memory>
#include "sfg/sfg.h"
#include "splatkit/engine/SplatEngine.h"

namespace splatkit {
// Platform storage outlives the renderer. Configure backend policy and backdrop through
// engineOf before loading; surface attachment remains the platform renderer's responsibility.
sfg_engine* makeSfgEngine(std::unique_ptr<SplatRenderer> renderer,
                          std::shared_ptr<void> platform = {});
SplatEngine& engineOf(sfg_engine* engine);
const SplatEngine& engineOf(const sfg_engine* engine);
}

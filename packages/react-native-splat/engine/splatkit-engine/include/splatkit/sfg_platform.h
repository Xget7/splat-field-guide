#pragma once

#include <memory>

#include "splatkit/engine/SplatEngine.h"
#include "splatkit/rendering/SplatRenderer.h"
#include "splatkit/sfg.h"

// For a platform's create function and its own view calls: the C handle over an engine.
namespace splatkit {

// An engine over the platform's renderer, owned by the handle until sfg_destroy. `platform`
// holds what the renderer borrows, such as its GPU device, and is released after the renderer.
sfg_engine* makeSfgEngine(std::unique_ptr<SplatRenderer> renderer,
                          SplatEngine::FileLoader loadFile = {},
                          std::shared_ptr<void> platform = {});
SplatEngine& engineOf(sfg_engine* engine);
const SplatEngine& engineOf(const sfg_engine* engine);

}

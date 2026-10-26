#pragma once

#include <cstdint>

namespace splatkit {

// Submission serials are monotonic for the renderer's one graphics queue.
// Reset only after a successful world replacement; old fences cannot ready the new world.
class WorldFrameCompletion {
 public:
  void reset() { firstSubmission_ = 0; }
  void submitted(uint64_t serial) {
    if (firstSubmission_ == 0) firstSubmission_ = serial;
  }
  bool completed(uint64_t serial) const {
    return firstSubmission_ != 0 && serial >= firstSubmission_;
  }

 private:
  uint64_t firstSubmission_ = 0;
};

}  // namespace splatkit

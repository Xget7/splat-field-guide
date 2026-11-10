#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <utility>

namespace splatkit {

// Hosts retain the engine and callback context through all in-flight calls. Replacement
// stops new dispatches from selecting the old sink; already selected calls may finish.
// Never wait for callbacks here: they can reenter the host or replace their own sink.
template <typename Event>
class EventDispatcher {
 public:
  using Sink = std::function<void(Event, const std::string&, uint32_t)>;

  void set(Sink sink) {
    auto next = sink ? std::make_shared<const Sink>(std::move(sink)) : nullptr;
    {
      const std::lock_guard<std::mutex> lock(mutex_);
      sink_.swap(next);
    }
    // Captures may run host code when destroyed, so release them outside the lock.
  }

  void emit(Event event, const std::string& message, uint32_t count) const {
    std::shared_ptr<const Sink> sink;
    {
      const std::lock_guard<std::mutex> lock(mutex_);
      sink = sink_;
    }
    // Keep captures alive through self-removal without locking across host code.
    if (sink) (*sink)(event, message, count);
  }

 private:
  mutable std::mutex mutex_;
  std::shared_ptr<const Sink> sink_;
};

}  // namespace splatkit

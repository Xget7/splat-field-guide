#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "splat/core/Result.h"

namespace splat {

// Read-only mapping avoids a heap copy and releases pages with the object's lifetime.
class MappedFile {
 public:
  // Unopenable, empty or unmappable files return unreadable with their path.
  static Result<MappedFile> open(const std::string& path);

  MappedFile(MappedFile&& other) noexcept;
  MappedFile& operator=(MappedFile&& other) noexcept;
  ~MappedFile();

  MappedFile(const MappedFile&) = delete;
  MappedFile& operator=(const MappedFile&) = delete;

  const std::uint8_t* data() const { return static_cast<const std::uint8_t*>(mapping_); }
  std::size_t size() const { return size_; }

 private:
  MappedFile(void* mapping, std::size_t size) : mapping_(mapping), size_(size) {}
  void release();

  void* mapping_ = nullptr;
  std::size_t size_ = 0;
};

}

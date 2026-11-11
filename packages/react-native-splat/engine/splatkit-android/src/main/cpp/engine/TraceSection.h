#pragma once

#include <android/trace.h>

#include <cstdint>

namespace splatkit {

// Slice names shown on the calling thread in Perfetto; scripts/perfetto_analysis.py matches them.
namespace trace {
inline constexpr char kFrame[] = "SplatKit frame";
inline constexpr char kWaitForFrameSlot[] = "SplatKit wait for frame slot";
inline constexpr char kEncodeCompute[] = "SplatKit encode compute";
inline constexpr char kSubmitPresent[] = "SplatKit submit and present";
inline constexpr char kUploadWorld[] = "SplatKit upload world";
inline constexpr char kUploadTile[] = "SplatKit upload tile";
inline constexpr char kSavePipelineCache[] = "SplatKit save pipeline cache";
inline constexpr char kDecodeWorld[] = "SplatKit decode world";
inline constexpr char kDecodeCollider[] = "SplatKit decode collider";
// Async slice on the process track; one benchmark runs at a time, so one cookie.
inline constexpr char kBenchmark[] = "SplatKit benchmark";
inline constexpr int32_t kBenchmarkCookie = 1;
}  // namespace trace

// Scoped slice; costs one flag check while nothing records the app.
class TraceSection {
 public:
  explicit TraceSection(const char* name) { ATrace_beginSection(name); }
  ~TraceSection() { ATrace_endSection(); }
  TraceSection(const TraceSection&) = delete;
  TraceSection& operator=(const TraceSection&) = delete;
};

}  // namespace splatkit

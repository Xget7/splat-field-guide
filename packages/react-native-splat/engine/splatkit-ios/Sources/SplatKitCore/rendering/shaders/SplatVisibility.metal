#include "SplatTypes.metalh"
#include "SplatProjection.metalh"

// One thread per splat: projects it, and appends the visible ones to the sort input keyed
// by squared distance to the camera. Positive IEEE floats sort in numeric order as uints.
kernel void visibility(uint t [[thread_position_in_grid]],
                       uint lane [[thread_index_in_simdgroup]],
                       constant Camera& cam [[buffer(0)]],
                       const device Splat* splats [[buffer(1)]],
                       constant uint& splatCount [[buffer(2)]],
                       device uint* keys [[buffer(3)]],
                       device uint* values [[buffer(4)]],
                       device atomic_uint* count [[buffer(5)]],
                       const device uint* shData [[buffer(6)]],
                       device Projected* projected [[buffer(7)]],
                       constant LabelStyle* styles [[buffer(8)]]) {
  bool visible = false;
  uint key = 0;
  Projected p;
  if (t < splatCount) {
    Splat s = splats[t];
    visible = projectSplat(cam, s, t, shData, styles, p);
    float3 d = float3(s.px, s.py, s.pz) - cam.cameraPosition.xyz;
    float distance2 = dot(d, d);
    key = as_type<uint>(distance2);
    visible = visible && isfinite(distance2);
  }
  // No lane returns before these collectives, including padded tail lanes.
  uint rank = simd_prefix_exclusive_sum(visible ? 1u : 0u);
  uint survivors = simd_sum(visible ? 1u : 0u);
  uint base = 0;
  if (lane == 0 && survivors > 0) {
    base = atomic_fetch_add_explicit(count, survivors, memory_order_relaxed);
  }
  base = simd_broadcast(base, 0);
  if (visible) {
    keys[base + rank] = key;
    values[base + rank] = base + rank;
    projected[base + rank] = p;
  }
}

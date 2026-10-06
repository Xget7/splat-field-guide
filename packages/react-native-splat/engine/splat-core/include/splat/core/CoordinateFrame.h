#pragma once

namespace splat {

// Input frames name the directions of +X, +Y and +Z; decoding converts once to RUB.
enum class CoordinateFrame {
  // World Labs Marble exports and OpenCV: +X right, +Y down, +Z forward.
  rdf,
  // glTF, three.js and the internal frame: +X right, +Y up, +Z back.
  rub,
};

constexpr CoordinateFrame kWorldLabsFrame = CoordinateFrame::rdf;
constexpr CoordinateFrame kInternalFrame = CoordinateFrame::rub;

}

// Draws a cloud through the engine and the Metal renderer, exactly as the app does, and
// writes the frame as a PNG: a part's review render, or a check that labels still sit on
// their splats.
//
//   splat_snapshot --spz high/cloud.spz --labels high/labels.bin --highlight 6 \
//       --pose 12.8,5,6.1 --out engine.png
//
// --pose is azimuth and elevation in degrees, then the radius, then optionally the
// target; --bounds frames six numbers (min then max) instead. Without either the whole
// cloud is framed from the front. --pick taps points given as x,y pairs in [0, 1] from the
// top left: each prints the label it picks and is marked on the image.

#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <QuartzCore/CAMetalLayer.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

#include "rendering/MetalSplatRenderer.h"
#include "splatkit/engine/SplatEngine.h"

namespace {

using splatkit::SplatEngine;

constexpr float kRadiansPerDegree = 3.14159265358979f / 180.0f;
constexpr int64_t kVsyncNanos = 16666667;
// Enough vsyncs for any framing or fade to finish.
constexpr int kMaxSettleFrames = 600;
constexpr int64_t kCaptureTimeoutNanos = 60 * NSEC_PER_SEC;
constexpr uint32_t kDefaultWidth = 1206;  // iPhone 17 Pro, portrait
constexpr uint32_t kDefaultHeight = 2622;
constexpr int kMarkerRadius = 24;  // pixels
constexpr int kMarkerThickness = 3;
constexpr uint8_t kMarkerBgra[4] = {0xFF, 0x00, 0xFF, 0xFF};  // magenta, unlike anything in a car

struct Options {
  std::string spz;
  std::string labels;
  std::string out;
  std::vector<uint8_t> highlight;
  std::vector<float> pose;
  std::vector<float> bounds;
  std::vector<float> picks;
  uint32_t width = kDefaultWidth;
  uint32_t height = kDefaultHeight;
};

std::vector<float> numbers(const std::string& list) {
  std::vector<float> values;
  std::stringstream stream(list);
  std::string item;
  while (std::getline(stream, item, ',')) values.push_back(std::stof(item));
  return values;
}

int usage() {
  std::fprintf(stderr,
               "usage: splat_snapshot --spz FILE [--labels FILE] [--highlight L,L]\n"
               "       [--pose AZ,EL,R[,X,Y,Z] | --bounds X,Y,Z,X,Y,Z] [--size WxH]\n"
               "       [--pick X,Y[,X,Y...]] --out FILE\n");
  return 2;
}

std::optional<Options> parse(int argc, char** argv) {
  Options o;
  for (int i = 1; i + 1 < argc; i += 2) {
    const std::string flag = argv[i];
    const std::string value = argv[i + 1];
    if (flag == "--spz") {
      o.spz = value;
    } else if (flag == "--labels") {
      o.labels = value;
    } else if (flag == "--out") {
      o.out = value;
    } else if (flag == "--highlight") {
      for (const float label : numbers(value)) o.highlight.push_back(static_cast<uint8_t>(label));
    } else if (flag == "--pose") {
      o.pose = numbers(value);
    } else if (flag == "--bounds") {
      o.bounds = numbers(value);
    } else if (flag == "--pick") {
      o.picks = numbers(value);
    } else if (flag == "--size") {
      if (std::sscanf(value.c_str(), "%ux%u", &o.width, &o.height) != 2) return std::nullopt;
    } else {
      return std::nullopt;
    }
  }
  const bool poseOk = o.pose.empty() || o.pose.size() == 3 || o.pose.size() == 6;
  const bool boundsOk = o.bounds.empty() || o.bounds.size() == 6;
  const bool picksOk = o.picks.size() % 2 == 0;
  if ((argc - 1) % 2 != 0 || o.spz.empty() || o.out.empty() || !poseOk || !boundsOk || !picksOk) {
    return std::nullopt;
  }
  return o;
}

// A cross centred on (x, y) in [0, 1], so a review shows where a pick landed.
void markPoint(std::vector<uint8_t>& bgra, uint32_t width, uint32_t height, float x, float y) {
  const int cx = static_cast<int>(x * width);
  const int cy = static_cast<int>(y * height);
  const auto paint = [&](int px, int py) {
    if (px < 0 || py < 0 || px >= static_cast<int>(width) || py >= static_cast<int>(height)) return;
    std::copy(std::begin(kMarkerBgra), std::end(kMarkerBgra), &bgra[(py * width + px) * 4]);
  };
  for (int d = -kMarkerRadius; d <= kMarkerRadius; ++d) {
    for (int t = -kMarkerThickness / 2; t <= kMarkerThickness / 2; ++t) {
      paint(cx + d, cy + t);
      paint(cx + t, cy + d);
    }
  }
}

bool writePng(const std::vector<uint8_t>& bgra, uint32_t width, uint32_t height,
              const std::string& path) {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGDataProviderRef data = CGDataProviderCreateWithData(nullptr, bgra.data(), bgra.size(), nullptr);
  CGImageRef image = CGImageCreate(width, height, 8, 32, width * 4, space,
                                   kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little, data,
                                   nullptr, false, kCGRenderingIntentDefault);
  NSURL* url = [NSURL fileURLWithPath:@(path.c_str())];
  CGImageDestinationRef destination =
      CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, nullptr);
  bool ok = destination != nullptr;
  if (ok) {
    CGImageDestinationAddImage(destination, image, nullptr);
    ok = CGImageDestinationFinalize(destination);
    CFRelease(destination);
  }
  CGImageRelease(image);
  CGDataProviderRelease(data);
  CGColorSpaceRelease(space);
  return ok;
}

}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    const auto options = parse(argc, argv);
    if (!options) return usage();
    const Options& o = *options;

    auto metal = splatkit::MetalSplatRenderer::create();
    if (!metal) {
      std::fprintf(stderr, "no Metal device of Apple GPU family 7 or later\n");
      return 1;
    }
    splatkit::MetalSplatRenderer* renderer = metal.get();
    CAMetalLayer* layer = [CAMetalLayer layer];
    layer.drawableSize = CGSizeMake(o.width, o.height);
    renderer->setLayer(layer);
    renderer->setDrawableSize(o.width, o.height);

    SplatEngine engine(std::move(metal));
    std::string failure;
    engine.setEventSink([&failure](SplatEngine::Event event, const std::string& message, uint32_t) {
      if (event != SplatEngine::Event::worldReady) failure = message;
    });
    engine.loadWorldFile(o.spz, o.labels, splat::CoordinateFrame::rub);
    if (!failure.empty()) {
      std::fprintf(stderr, "load failed: %s\n", failure.c_str());
      return 1;
    }
    if (!o.pose.empty()) {
      splatkit::OrbitPose pose;
      pose.azimuth = o.pose[0] * kRadiansPerDegree;
      pose.elevation = o.pose[1] * kRadiansPerDegree;
      pose.radius = o.pose[2];
      if (o.pose.size() == 6) pose.target = {o.pose[3], o.pose[4], o.pose[5]};
      engine.setCameraPose(pose);
    } else if (!o.bounds.empty()) {
      splat::Bounds bounds;
      bounds.min = {o.bounds[0], o.bounds[1], o.bounds[2]};
      bounds.max = {o.bounds[3], o.bounds[4], o.bounds[5]};
      if (!engine.frame(bounds, 0)) {
        std::fprintf(stderr, "bad bounds\n");
        return 2;
      }
    }
    engine.setHighlight(o.highlight.data(), o.highlight.size());

    // Let the world upload and any framing or fade finish, as a still phone would.
    int64_t now = kVsyncNanos;
    for (int frame = 0; frame < kMaxSettleFrames; ++frame, now += kVsyncNanos) {
      if (!engine.render(now) && frame > 0) break;
    }
    dispatch_semaphore_t captured = dispatch_semaphore_create(0);
    std::vector<uint8_t> pixels;
    renderer->captureNextFrame([&](std::vector<uint8_t> image, uint32_t, uint32_t) {
      pixels = std::move(image);
      dispatch_semaphore_signal(captured);
    });
    engine.requestRedraw();
    if (!engine.render(now) ||
        dispatch_semaphore_wait(captured, dispatch_time(DISPATCH_TIME_NOW, kCaptureTimeoutNanos)) !=
            0) {
      std::fprintf(stderr, "no frame was drawn\n");
      return 1;
    }
    engine.publishStats();
    const auto stats = engine.stats();
    const auto& pose = engine.cameraPose();
    std::printf("%u of %u splats drawn, gpu %.1f ms; pose az %.1f el %.1f r %.3f at (%.3f, %.3f, "
                "%.3f)\n",
                stats.drawnSplatCount, stats.splatCount, stats.gpuMillis,
                pose.azimuth / kRadiansPerDegree, pose.elevation / kRadiansPerDegree, pose.radius,
                pose.target.x, pose.target.y, pose.target.z);
    for (size_t i = 0; i < o.picks.size(); i += 2) {
      const auto start = std::chrono::steady_clock::now();
      const uint8_t label = engine.pick(o.picks[i], o.picks[i + 1]);
      const double millis =
          std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
      std::printf("pick %.3f,%.3f: label %u in %.1f ms\n", o.picks[i], o.picks[i + 1], label, millis);
      markPoint(pixels, o.width, o.height, o.picks[i], o.picks[i + 1]);
    }
    if (!writePng(pixels, o.width, o.height, o.out)) {
      std::fprintf(stderr, "could not write %s\n", o.out.c_str());
      return 1;
    }
    return 0;
  }
}

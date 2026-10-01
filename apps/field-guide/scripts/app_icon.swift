import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Field Guide app icon: a cloud of grey splats, one part tinted marine blue, named by the
// viewer's callout: a pin on the part and a tag on a leader above it. Seeded, so it renders the same icon every time:
//   swift scripts/app_icon.swift ios/FieldGuide/Images.xcassets/AppIcon.appiconset/AppIcon.png
let size = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"

var seed: UInt64 = 0x5EED_F1E1D
func rand() -> Double {
  seed = seed &* 6364136223846793005 &+ 1442695040888963407
  return Double(seed >> 11) / Double(1 << 53)
}
func gauss() -> Double {
  let u = max(rand(), 1e-9), v = rand()
  return sqrt(-2 * log(u)) * cos(2 * .pi * v)
}

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(
  data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
// Top-left origin, like the design.
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
// Fill the icon: the design is drawn on a 1024 canvas and scaled up around the centre.
ctx.translateBy(x: 512, y: 512)
ctx.scaleBy(x: 1.22, y: 1.22)
ctx.translateBy(x: -512, y: -512)

func splat(_ x: Double, _ y: Double, _ sx: Double, _ sy: Double, _ angle: Double,
           _ r: Double, _ g: Double, _ b: Double, _ a: Double) {
  let colors = [
    CGColor(srgbRed: r, green: g, blue: b, alpha: a),
    CGColor(srgbRed: r, green: g, blue: b, alpha: a * 0.94),
    CGColor(srgbRed: r, green: g, blue: b, alpha: a * 0.5),
    CGColor(srgbRed: r, green: g, blue: b, alpha: 0),
  ] as CFArray
  // A splat drawn to two sigma, firm in the middle so each one reads on its own.
  let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 0.62, 0.86, 1])!
  ctx.saveGState()
  ctx.translateBy(x: x, y: y)
  ctx.rotate(by: angle)
  ctx.scaleBy(x: sx, y: sy)
  ctx.drawRadialGradient(gradient, startCenter: .zero, startRadius: 0, endCenter: .zero,
                         endRadius: 2, options: [])
  ctx.restoreGState()
}

let center = (x: 512.0, y: 512.0)

// The bay: discrete grey splats, denser in the middle and fading out like the viewer's vignette.
for _ in 0..<110 {
  let radius = 300 * pow(rand(), 0.75)
  let theta = 2 * .pi * rand()
  let x = center.x + radius * cos(theta) * 1.1
  let y = center.y + 12 + radius * sin(theta) * 0.95
  let falloff = max(0, 1 - radius / 330)
  let light = 0.18 + 0.5 * pow(rand(), 1.5)
  let sigma = 8 + 18 * rand()
  splat(x, y, sigma * (1 + 1.8 * rand()), sigma, .pi * rand(),
        light * 1.04, light, light * 0.93, (0.65 + 0.35 * rand()) * (0.25 + 0.75 * falloff))
}

// The highlighted part: a cluster of accent splats in a few shades, so each one reads.
for _ in 0..<34 {
  let radius = 96 * sqrt(rand())
  let theta = 2 * .pi * rand()
  let dx = radius * cos(theta) * 0.9, dy = radius * sin(theta)
  let shade = rand()
  let sigma = 14 + 12 * rand()
  // From #1C5DA8 through #2576D2 to #7DB3EF.
  let (r, g, b) = shade < 0.5
    ? (0.110 + 0.070 * shade * 2, 0.365 + 0.098 * shade * 2, 0.659 + 0.165 * shade * 2)
    : (0.145 + 0.345 * (shade - 0.5) * 2, 0.463 + 0.239 * (shade - 0.5) * 2,
       0.824 + 0.113 * (shade - 0.5) * 2)
  splat(512 + dx, 590 + dy, sigma * (1 + 0.9 * rand()), sigma, .pi * rand(), r, g, b, 1)
}

// The viewer's callout: leader, then the tag and the pin over it.
let accent = CGColor(srgbRed: 0.145, green: 0.463, blue: 0.824, alpha: 1)
let pin = CGPoint(x: 512, y: 520)
let tag = CGRect(x: 512 - 150, y: 300, width: 300, height: 76)
ctx.setStrokeColor(accent)
ctx.setLineWidth(14)
ctx.move(to: CGPoint(x: pin.x, y: tag.maxY))
ctx.addLine(to: pin)
ctx.strokePath()
ctx.setFillColor(accent)
ctx.addPath(CGPath(roundedRect: tag, cornerWidth: 18, cornerHeight: 18, transform: nil))
ctx.fillPath()
// The name, as a line of text too small to read.
ctx.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.9))
ctx.addPath(CGPath(
  roundedRect: tag.insetBy(dx: 40, dy: 30), cornerWidth: 8, cornerHeight: 8, transform: nil))
ctx.fillPath()
// The pin: accent with a black ring, as in the viewer.
ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 1))
ctx.fillEllipse(in: CGRect(x: pin.x - 34, y: pin.y - 34, width: 68, height: 68))
ctx.setFillColor(accent)
ctx.fillEllipse(in: CGRect(x: pin.x - 22, y: pin.y - 22, width: 44, height: 44))

let image = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(
  URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out)")

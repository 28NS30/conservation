// A QR code as a static SVG, for the printable poster (apps/web/app/[locale]/poster).
//
//   swift scripts/make-qr.swift <text> <out.svg> [out.png]
//
// macOS only: it uses CoreImage's own generator, so the site carries no QR
// library and draws nothing at run time. The SVG is committed; run this again
// only when the address it encodes changes. The optional PNG is for checking
// the code decodes (CoreImage's CIDetector reads it back) before committing.
//
// Error correction M (15%): enough for a poster that gets folded, pinned and
// photographed at an angle, and still a small code for a short address.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else {
  print("usage: swift scripts/make-qr.swift <text> <out.svg> [out.png]")
  exit(2)
}
let text = args[1]

let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(text.data(using: .utf8), forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
let image = filter.outputImage!

// One pixel per module, quiet zone included (CoreImage adds one module; the
// SVG below adds the rest of the standard four).
let context = CIContext()
let cg = context.createCGImage(image, from: image.extent)!
let w = cg.width, h = cg.height
var pixels = [UInt8](repeating: 0, count: w * h)
let gray = CGContext(
  data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
gray.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
func dark(_ x: Int, _ y: Int) -> Bool { pixels[y * w + x] < 128 }

// Trim CoreImage's own margin so the quiet zone is exactly four modules.
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h { for x in 0..<w where dark(x, y) {
  minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
} }
let n = maxX - minX + 1
let quiet = 4
let size = n + 2 * quiet

// One path of horizontal runs: a few hundred bytes, and crisp at any scale.
var d = ""
for y in 0..<n {
  var x = 0
  while x < n {
    if dark(minX + x, minY + y) {
      var run = 1
      while x + run < n && dark(minX + x + run, minY + y) { run += 1 }
      d += "M\(x + quiet) \(y + quiet)h\(run)v1h-\(run)z"
      x += run
    } else { x += 1 }
  }
}
let svg = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(size) \(size)" shape-rendering="crispEdges">\
<rect width="\(size)" height="\(size)" fill="#fff"/><path fill="#000" d="\(d)"/></svg>

"""
try! svg.write(toFile: args[2], atomically: true, encoding: .utf8)
print("\(n)×\(n) modules, \(svg.utf8.count) bytes: \(args[2])")

if args.count >= 4 {
  // The same modules at 10 px each, for CIDetector to read back.
  let scale = 10
  let side = size * scale
  var out = [UInt8](repeating: 255, count: side * side)
  for y in 0..<n { for x in 0..<n where dark(minX + x, minY + y) {
    for dy in 0..<scale { for dx in 0..<scale {
      out[((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx] = 0
    } }
  } }
  let provider = CGDataProvider(data: Data(out) as CFData)!
  let png = CGImage(
    width: side, height: side, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: side,
    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0),
    provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
  let dest = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: args[3]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, png, nil)
  CGImageDestinationFinalize(dest)
}

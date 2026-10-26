// What WebKit's canvas encoder writes on Apple platforms, for
// test/photo-metadata.test.mjs. ImageBufferUtilitiesCG.cpp hands ImageIO the
// bitmap and a lossy-compression quality, nothing else; ImageIO adds an Exif
// block of its own (colour space, pixel dimensions) and, in a JPEG, an APP13
// block with an empty IPTC record. Every browser on an iPhone is WebKit.
//
//   cd apps/web/test/fixtures && swift imageio-canvas.swift
//
// Run on macOS 26.5 on 26 October 2026 to make imageio-canvas.jpg and
// imageio-canvas.png. It also says whether ImageIO can write WebP at all: it
// could not, which is why Safari's toBlob("image/webp") hands back a PNG.
import Foundation
import CoreGraphics
import ImageIO

let w = 64, h = 48
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 0.2, green: 0.6, blue: 0.3, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
let image = ctx.makeImage()!

let writable = CGImageDestinationCopyTypeIdentifiers() as! [String]
print("ImageIO can write WebP:", writable.contains { $0.contains("webp") })

for (uti, name) in [("public.jpeg", "imageio-canvas.jpg"), ("public.png", "imageio-canvas.png")] {
  let data = CFDataCreateMutable(nil, 0)!
  let dest = CGImageDestinationCreateWithData(data, uti as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
  CGImageDestinationFinalize(dest)
  FileManager.default.createFile(atPath: name, contents: data as Data)
  print("wrote", name, CFDataGetLength(data), "bytes")
}

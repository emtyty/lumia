#!/usr/bin/env swift
// Native macOS OCR using Apple Vision framework
// Usage: swift ocr-vision.swift <image-path>
// Output: JSON array of { text, x, y, width, height, confidence }
// Coordinates are normalized 0-1 with origin at bottom-left (Vision standard)

import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    fputs("Usage: ocr-vision.swift <image-path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath),
      let tiffData = image.tiffRepresentation,
      let cgImage = NSBitmapImageRep(data: tiffData)?.cgImage else {
    fputs("Error: Cannot load image at \(imagePath)\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

var results: [[String: Any]] = []
if let observations = request.results {
    for obs in observations {
        let candidate = obs.topCandidates(1).first
        guard let text = candidate?.string else { continue }
        let box = obs.boundingBox
        results.append([
            "text": text,
            "x": box.origin.x,
            "y": box.origin.y,
            "width": box.size.width,
            "height": box.size.height,
            "confidence": obs.confidence
        ])
    }
}

let json = try JSONSerialization.data(withJSONObject: results, options: [])
print(String(data: json, encoding: .utf8)!)

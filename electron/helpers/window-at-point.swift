// Long-running window-at-point helper for macOS.
//
// Protocol:
//   - argv[1] (optional): PID to exclude from results (Lumia's own windows).
//   - stdin:  one query per line, format "x y" in screen-DIP / points (top-left origin).
//   - stdout: one JSON object per query, or the literal string "null".
//             { "x": <pt>, "y": <pt>, "width": <pt>, "height": <pt> }
//   - exits when stdin is closed.
//
// Permissions: reading window names requires Screen Recording, but bounds + PID
// + layer are returned without any prompt.
//
// Build: swiftc electron/helpers/window-at-point.swift -o electron/helpers/window-at-point

import Foundation
import CoreGraphics

let ownPid = Int(ProcessInfo.processInfo.processIdentifier)
let excludePid: Int = CommandLine.arguments.count >= 2
    ? (Int(CommandLine.arguments[1]) ?? -1)
    : -1

setbuf(stdout, nil)

while let line = readLine(strippingNewline: true) {
    let parts = line.split(separator: " ").compactMap { Double($0) }
    if parts.count < 2 {
        print("null")
        continue
    }
    let pt = CGPoint(x: parts[0], y: parts[1])

    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        print("null")
        continue
    }

    var emitted = false
    // CGWindowListCopyWindowInfo returns front-to-back z-order; first hit wins.
    for w in info {
        // Layer 0 == regular app windows. Higher layers are dock/menu/popup chrome.
        guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
        if let pid = w[kCGWindowOwnerPID as String] as? Int {
            if pid == ownPid { continue }
            if excludePid >= 0 && pid == excludePid { continue }
        }
        if let alpha = w[kCGWindowAlpha as String] as? Double, alpha <= 0.01 { continue }
        guard let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict) else { continue }
        // Skip degenerate slivers (offscreen helpers / 1px windows).
        if bounds.width < 8 || bounds.height < 8 { continue }
        if !bounds.contains(pt) { continue }

        let json: [String: Any] = [
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.size.width,
            "height": bounds.size.height,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: json),
           let str = String(data: data, encoding: .utf8) {
            print(str)
            emitted = true
        }
        break
    }
    if !emitted { print("null") }
}

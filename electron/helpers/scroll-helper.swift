import CoreGraphics
import Foundation

// Usage: scroll-helper <cx> <cy> <pixelDelta>
// Moves cursor to (cx, cy) then sends a pixel-based scroll wheel event.
// Requires Accessibility permission (System Settings → Privacy → Accessibility).

guard CommandLine.arguments.count >= 4,
      let cx = Double(CommandLine.arguments[1]),
      let cy = Double(CommandLine.arguments[2]),
      let delta = Int32(CommandLine.arguments[3]) else {
    fputs("Usage: scroll-helper <cx> <cy> <pixelDelta>\n", stderr)
    exit(1)
}

// Move cursor to target position
if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                      mouseCursorPosition: CGPoint(x: cx, y: cy), mouseButton: .left) {
    move.post(tap: .cghidEventTap)
}

// Small pause so the OS registers the cursor position
usleep(30_000) // 30ms

// Scroll via pixel-based event (CGEventCreateScrollWheelEvent2)
if let scroll = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                        wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) {
    scroll.post(tap: .cghidEventTap)
}

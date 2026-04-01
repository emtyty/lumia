# Lumia

A cross-platform screen capture, annotation, and sharing tool for **Windows** and **macOS** — built with Electron, React, and TypeScript.

Inspired by ShareX, rebuilt from scratch as **Lumia** with a modern Liquid Glass UI, a workflow engine, video annotation, and true parallel multi-destination uploads.

---

## Features

### Capture
| Mode | Shortcut |
|---|---|
| Region (drag to select) | `Ctrl+Shift+4` |
| Fullscreen | `Ctrl+Shift+3` |
| Active Window | `Ctrl+Shift+2` |
| Screen Recorder | `Ctrl+Shift+R` |
| GIF Recorder | `Ctrl+Shift+G` |
| Stop Recording | `Ctrl+Shift+S` |
| Open App | `Ctrl+Shift+X` |

All shortcuts use `Ctrl+Shift` — no conflicts with macOS built-ins (`Cmd+Shift`). Every shortcut is rebindable in Settings.

### Annotation Editor
Draw on any screenshot before sharing:
- **Pen** — freehand with smoothing
- **Rectangle / Ellipse / Arrow** — drag to draw
- **Text** — click to place inline input
- **Blur** — censor sensitive areas
- **Select** — move and reposition annotations
- Image auto-scales to fit the viewport; exports at full natural resolution

### Video Annotator
Open any `.webm` recording for frame-accurate annotation:
- Scrub the timeline, pause on any frame, and draw annotations
- All drawing tools available (pen, rect, ellipse, arrow, text)
- **Extract Frame** — exports the current frame as a PNG into the annotation editor
- **Export Frame** — composites the current frame + drawings into a shareable PNG
- **Export Video** — renders a new `.webm` with annotations baked into every frame (real-time render with progress bar + cancel)
- Duration auto-detected for MediaRecorder WebM files (no duration header issue)

### Workflow Engine
Templates define the full pipeline for every capture:

```
After Capture  →  Upload (parallel)  →  After Upload
annotate           imgur                  copy URL
save to disk       custom HTTP            open URL
copy to clipboard                         OS share
                                          notify
```

- Set any workflow as the **default** with the star button — active workflow is highlighted across the app
- Four built-in templates ship by default; create unlimited custom templates in the **Destinations** screen
- Multi-destination upload runs all destinations in parallel via `Promise.allSettled` — one failure never blocks the others

### Sharing Options
- Copy image to clipboard
- Save to disk (PNG / WebM)
- Upload to Imgur (anonymous or with your own Client ID)
- Upload to any custom HTTP endpoint with optional Bearer token
- OS native share sheet (Windows 11 / macOS)

### History
- Every capture is saved with thumbnail, timestamp, file type, and upload status
- Search by name, filter by type (screenshot / recording)
- Click any recording to open it directly in the Video Annotator
- Click any screenshot to open it in the Annotation Editor

### Settings
- **Default Save Path** — folder picker dialog (defaults to system Downloads)
- **Imgur Client ID** — bring your own to avoid rate limits
- **Custom HTTP Upload** — endpoint URL, field name, Authorization header
- **Theme** — dark / light mode toggle (persisted, applies immediately including native title bar controls on Windows)

---

## Tech Stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron 33 |
| Build system | electron-vite 2 |
| UI | React 18 + TypeScript |
| Routing | React Router 6 (hash mode) |
| Canvas / Annotation | Konva.js + react-konva |
| Styling | Tailwind CSS 4 + Liquid Glass design system |
| Settings & History | electron-store 8 |
| Packaging | electron-builder |

---

## Project Structure

```
shareanywhere/
├── electron/
│   ├── index.ts          # App lifecycle, window factory, all IPC handlers
│   ├── preload/
│   │   └── index.ts      # contextBridge — exposes electronAPI to renderer
│   ├── capture.ts        # desktopCapturer wrapper, region crop
│   ├── hotkeys.ts        # globalShortcut registration
│   ├── tray.ts           # System tray icon + context menu
│   ├── workflow.ts       # WorkflowEngine — parallel upload orchestration
│   ├── templates.ts      # Built-in templates + user template CRUD
│   ├── history.ts        # Capture history persistence
│   ├── settings.ts       # electron-store settings (theme, paths, keys)
│   └── uploaders/
│       ├── imgur.ts      # Imgur API client
│       └── custom.ts     # Generic HTTP uploader
├── src/
│   ├── main.tsx          # React entry point
│   ├── App.tsx           # Router + TitleBar + Sidebar layout
│   ├── index.css         # Liquid Glass design tokens + light/dark mode
│   ├── electron.d.ts     # window.electronAPI type declarations
│   ├── types.ts          # Shared renderer types
│   ├── hooks/
│   │   └── useLocalVideoUrl.ts  # IPC file read → Blob URL for video playback
│   ├── components/
│   │   ├── TitleBar.tsx             # VSCode-style custom title bar
│   │   ├── Sidebar.tsx              # Navigation sidebar + theme toggle
│   │   ├── ShareDialog.tsx          # Share action modal
│   │   ├── VideoRecorder.tsx        # Screen recording modal
│   │   └── AnnotationCanvas/
│   │       └── Canvas.tsx           # Konva stage — all drawing tools, scale-to-fit
│   └── windows/
│       ├── dashboard/Dashboard.tsx       # Capture launcher + sortable recent artifacts
│       ├── editor/Editor.tsx             # Annotation editor
│       ├── history/History.tsx           # Capture history grid + search/filter
│       ├── workflow/Workflow.tsx         # Destinations & pipeline editor
│       ├── settings/Settings.tsx         # App settings
│       ├── overlay/Overlay.tsx           # Transparent region-select overlay
│       └── video-annotator/
│           └── VideoAnnotator.tsx        # Video playback + frame annotation + WebM export
├── resources/            # App icons (icon.png, icon.ico, icon.icns)
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+

### Install & Run

```bash
# Install dependencies
npm install

# Start in development mode (hot reload + DevTools in hamburger menu)
npm run dev

# Build for production
npm run build

# Package for distribution
npm run dist        # produces .exe (Windows) and .dmg (macOS)
```

### Development Notes

- Renderer runs at `http://localhost:5173` during dev; hash routing (`/#/dashboard`, `/#/editor`, etc.) drives navigation
- The overlay window is a separate transparent `BrowserWindow` at `/#/overlay`
- All IPC is bridged via `contextBridge` in `preload/index.ts` — no `nodeIntegration`
- **DevTools** accessible from the hamburger menu (≡) in dev mode
- On Windows, the native min/max/close buttons (`titleBarOverlay`) update their colors when toggling dark/light mode

---

## Default Workflows

| Template | Pipeline |
|---|---|
| **Quick Clipboard** | capture → copy to clipboard → notify |
| **Save to Disk** | capture → annotate → save to default save path |
| **Upload & Copy Link** | capture → annotate → upload to Imgur → copy URL → notify |
| **Full Share** | capture → annotate → save + upload to Imgur (parallel) → copy URL → OS share |

Built-in templates cannot be deleted. Set any template as the **active/default** workflow by clicking the star (⭐) next to it in the Destinations screen — the active workflow is shown in the page header and used by the "Share" button in the editor.

---

## Design System — Liquid Glass Architecture

| Token | Value |
|---|---|
| Background | `#050810` (deep space) |
| Primary | `#b6a0ff` (lavender) |
| Secondary | `#00e3fd` (cyan) |
| Tertiary | `#ff6c95` (pink) |
| Typography | Manrope (headlines) + Inter (body) |

**Core rules:**
- All containers translucent — `backdrop-filter: blur(40px)`, never 100% opaque
- No hard borders or dividers — tonal surface shifts and spacing only
- CTAs use a `135deg` gradient from primary → secondary, `scale(1.02)` on hover
- Shadows are refractive glows (40–80px blur at ~6% opacity), never solid black

**Light mode** (`html.light` class): full color variable overrides + Tailwind class remaps, toggled from the sidebar and persisted to settings.

---

## Roadmap

- [ ] More upload destinations (S3, Dropbox, Google Drive)
- [ ] OCR on captured region
- [ ] Scrolling capture
- [ ] Hotkey rebinding UI
- [ ] GIF recording
- [ ] Audio recording support in screen recorder

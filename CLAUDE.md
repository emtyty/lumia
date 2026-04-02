# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Lumia?

Lumia is a cross-platform Electron desktop app for screen capture, annotation, and sharing (Windows + macOS). Built with Electron 33, React 18, TypeScript, and Tailwind CSS 4.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev mode (renderer at localhost:5173, main process hot-reloads) |
| `pnpm build` | Compile main, preload, and renderer to `out/` |
| `pnpm preview` | Preview production build without packaging |
| `pnpm pack` | Build + create unpacked package for testing |
| `pnpm pack:mac` | Build + package for macOS |
| `pnpm pack:win` | Build + package for Windows |
| `pnpm dist` | Build + package for distribution (exe/dmg) |

No test framework, linter, or formatter is configured.

## Architecture

### Process Model (Electron)

- **Main process**: `electron/index.ts` — app lifecycle, window creation, ALL IPC handlers (~70+ `ipcMain.handle` calls)
- **Preload**: `electron/preload/index.ts` — `contextBridge.exposeInMainWorld('electronAPI', {...})` strict whitelist
- **Renderer**: `src/` — React SPA with hash routing (`/#/dashboard`, `/#/editor`, etc.)

Context isolation is on, nodeIntegration is off. All renderer↔main communication goes through the preload bridge.

### Main Process Modules (`electron/`)

| File | Responsibility |
|------|---------------|
| `capture.ts` | desktopCapturer wrapper (fullscreen/region/window modes) |
| `hotkeys.ts` | globalShortcut registration + HotkeyConfig electron-store |
| `tray.ts` | System tray icon + context menu |
| `workflow.ts` | WorkflowEngine — three-phase pipeline: after-capture → upload (parallel) → after-upload |
| `templates.ts` | TemplateStore — CRUD for workflow templates + 4 built-in templates |
| `history.ts` | HistoryStore — capture history persistence (max 200 items) |
| `settings.ts` | AppSettings interface + electron-store wrapper |
| `types.ts` | Shared TypeScript interfaces |
| `uploaders/imgur.ts` | Imgur API v3 uploader |
| `uploaders/custom.ts` | Generic HTTP multipart form uploader |

### Renderer (`src/`)

- **Entry**: `src/main.tsx` → HashRouter
- **Layout**: `App.tsx` wraps routes with `TitleBar` + `Sidebar`
- **Drawing**: `components/AnnotationCanvas/Canvas.tsx` — Konva stage with pen, shapes, text, blur, select tools
- **Routes**: dashboard, editor, history, workflow, settings, video-annotator, overlay
- **State passing**: React Router `location.state` (e.g., captured dataUrl sent to editor)

### Window Management

- **Main window**: 1200×780, frameless, platform-specific title bars (macOS traffic lights / Windows overlay)
- **Overlay window**: Transparent fullscreen for region selection, always-on-top, separate BrowserWindow

### Persistence (electron-store)

Four isolated stores: `settings`, `templates`, `history`, `hotkeys`.

### Design System — Liquid Glass

Custom CSS design tokens in `src/index.css`. Key classes: `.glass-refractive`, `.liquid-glass`, `.card-organic`, `.glass-card`. Uses Manrope (headlines) + Inter (body) fonts + Material Icons. Light/dark theme toggle via `html.light` class.

### Build Tooling

- **electron-vite** compiles three targets: main (`electron/`), preload (`electron/preload/`), renderer (`src/`)
- **Path alias**: `@/` → `src/`
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin
- **electron-builder** packages to `dist/` (NSIS for Windows, DMG for macOS arm64)

## Platform-Specific Notes

- **Windows**: Uses legacy DXGI capturer (GDI fallback) to avoid Windows 11 WGC issues. Frameless window with native overlay controls.
- **macOS**: Hidden inset title bar with traffic lights at x:18, y:20. arm64 only. Graphics/design category.
- **Capture timing**: 200ms delay after hiding main window to ensure clean screen capture.

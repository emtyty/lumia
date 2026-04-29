import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import Dashboard from './windows/dashboard/Dashboard'
import { AboutDialog } from './components/AboutDialog'
import { ReleaseNotesDialog } from './components/ReleaseNotesDialog'
import { UpdateNotification } from './components/UpdateNotification'

// Code-split heavy routes. Konva (~150KB) only loads when Editor opens;
// each standalone window only pulls its own renderer chunk instead of the
// full app bundle. Dashboard stays eager — it's the home route, lazy-loading
// it would put a Suspense fallback in front of the user on app launch.
const Editor = lazy(() => import('./windows/editor/Editor'))
const Workflow = lazy(() => import('./windows/workflow/Workflow'))
const Settings = lazy(() => import('./windows/settings/Settings'))
const Overlay = lazy(() => import('./windows/overlay/Overlay'))
const RecordingToolbar = lazy(() => import('./windows/recording-toolbar/RecordingToolbar'))
const RecordingBorder = lazy(() => import('./windows/recording-border/RecordingBorder'))
const RecorderHost = lazy(() => import('./windows/recorder-host/RecorderHost'))
const AnnotationOverlay = lazy(() => import('./windows/annotation-overlay/AnnotationOverlay'))
const AnnotationToolbar = lazy(() => import('./windows/annotation-toolbar/AnnotationToolbar'))

const STANDALONE_ROUTES = ['/overlay', '/recording-toolbar', '/recording-border', '/recorder-host', '/annotation-overlay', '/annotation-toolbar']

function isStandaloneHash(): boolean {
  const hash = window.location.hash.replace(/^#/, '')
  return STANDALONE_ROUTES.some(r => hash === r || hash.startsWith(r + '?') || hash.startsWith(r + '/'))
}

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const standalone = isStandaloneHash()
  // Editor runs full-width (handles both image and video modes) — its own
  // toolbars replace the sidebar, and it needs every pixel of canvas space.
  const isFullWidth = !standalone && location.pathname === '/editor'

  useEffect(() => {
    window.electronAPI?.onNavigate((route, state) => {
      navigate(route, state ? { state } : undefined)
    })
    return () => { window.electronAPI?.removeAllListeners('navigate') }
  }, [navigate])

  useEffect(() => {
    if (standalone) return
    window.electronAPI?.notifyRoute?.(location.pathname)
  }, [location.pathname, standalone])

  // Standalone windows — no sidebar/title bar, body transparent where applicable.
  // Suspense fallback is null: standalone windows are transparent or pre-warmed
  // hidden, so a loading shimmer would either flash or be invisible anyway.
  if (standalone) {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/overlay" element={<Overlay />} />
          <Route path="/recording-toolbar" element={<RecordingToolbar />} />
          <Route path="/recording-border" element={<RecordingBorder />} />
          <Route path="/recorder-host" element={<RecorderHost />} />
          <Route path="/annotation-overlay" element={<AnnotationOverlay />} />
          <Route path="/annotation-toolbar" element={<AnnotationToolbar />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden min-h-0">
      {!isFullWidth && <Sidebar />}
      <main className={`flex-1 overflow-hidden ${isFullWidth ? '' : 'ml-64'}`}>
        <Suspense fallback={<div className="w-full h-full" />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/editor" element={<Editor />} />
            {/* /history merged into /dashboard — stale links redirect. */}
            <Route path="/history" element={<Navigate to="/dashboard" replace />} />
            <Route path="/workflow" element={<Workflow />} />
            <Route path="/settings" element={<Settings />} />
            {/* /video-annotator merged into /editor — stale links redirect. */}
            <Route path="/video-annotator" element={<Navigate to="/editor" replace />} />
          </Routes>
        </Suspense>
      </main>
      </div>
      <AboutDialog />
      <ReleaseNotesDialog />
      <UpdateNotification />
    </div>
  )
}

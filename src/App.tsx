import { useEffect } from 'react'
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import Dashboard from './windows/dashboard/Dashboard'
import Editor from './windows/editor/Editor'
import History from './windows/history/History'
import Workflow from './windows/workflow/Workflow'
import Settings from './windows/settings/Settings'
import Overlay from './windows/overlay/Overlay'
import RecordingToolbar from './windows/recording-toolbar/RecordingToolbar'
import RecordingBorder from './windows/recording-border/RecordingBorder'
import RecorderHost from './windows/recorder-host/RecorderHost'
import { AboutDialog } from './components/AboutDialog'
import { ReleaseNotesDialog } from './components/ReleaseNotesDialog'

const STANDALONE_ROUTES = ['/overlay', '/recording-toolbar', '/recording-border', '/recorder-host']

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
  if (standalone) {
    return (
      <Routes>
        <Route path="/overlay" element={<Overlay />} />
        <Route path="/recording-toolbar" element={<RecordingToolbar />} />
        <Route path="/recording-border" element={<RecordingBorder />} />
        <Route path="/recorder-host" element={<RecorderHost />} />
      </Routes>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden min-h-0">
      {!isFullWidth && <Sidebar />}
      <main className={`flex-1 overflow-hidden ${isFullWidth ? '' : 'ml-64'}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/history" element={<History />} />
          <Route path="/workflow" element={<Workflow />} />
          <Route path="/settings" element={<Settings />} />
          {/* /video-annotator merged into /editor — stale links redirect. */}
          <Route path="/video-annotator" element={<Navigate to="/editor" replace />} />
        </Routes>
      </main>
      </div>
      <AboutDialog />
      <ReleaseNotesDialog />
    </div>
  )
}

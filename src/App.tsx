import { useEffect } from 'react'
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import Dashboard from './windows/dashboard/Dashboard'
import Editor from './windows/editor/Editor'
import History from './windows/history/History'
import Workflow from './windows/workflow/Workflow'
import Settings from './windows/settings/Settings'
import VideoAnnotator from './windows/video-annotator/VideoAnnotator'
import Overlay from './windows/overlay/Overlay'
import { AboutDialog } from './components/AboutDialog'

const OVERLAY_ROUTE = '/overlay'

export default function App() {
  const navigate = useNavigate()
  const isOverlay = window.location.hash === `#${OVERLAY_ROUTE}`

  useEffect(() => {
    window.electronAPI?.onNavigate((route, state) => {
      navigate(route, state ? { state } : undefined)
    })
    return () => { window.electronAPI?.removeAllListeners('navigate') }
  }, [navigate])

  // Overlay is a standalone transparent window — no sidebar
  if (isOverlay) {
    return (
      <Routes>
        <Route path="/overlay" element={<Overlay />} />
      </Routes>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden min-h-0">
      <Sidebar />
      <main className="flex-1 overflow-hidden ml-64">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/history" element={<History />} />
          <Route path="/workflow" element={<Workflow />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/video-annotator" element={<VideoAnnotator />} />
          <Route path="/overlay" element={<Overlay />} />
        </Routes>
      </main>
      </div>
      <AboutDialog />
    </div>
  )
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// Standalone transparent windows (annotation overlay, palette, recording
// toolbar/border, recorder host, region overlay) must have a transparent
// body from the very first paint — otherwise the dark gradient body that
// the main app routes use shows up for one frame and looks like a flash
// when the BrowserWindow appears. Set this synchronously before React
// renders so even ready-to-show fires against an already-clear body.
const TRANSPARENT_HASHES = [
  '#/annotation-overlay',
  '#/annotation-toolbar',
  '#/recording-toolbar',
  '#/recording-border',
  '#/recorder-host',
  '#/overlay',
]
if (TRANSPARENT_HASHES.some(h => window.location.hash === h || window.location.hash.startsWith(h + '?') || window.location.hash.startsWith(h + '/'))) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.backgroundImage = 'none'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>
)

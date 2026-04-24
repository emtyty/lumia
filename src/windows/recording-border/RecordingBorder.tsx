import { useEffect } from 'react'

/** Decorative 3px red border around the recording region. Covers the whole
 *  window — the main process sizes the window as rect + stroke on all sides. */
export default function RecordingBorder() {
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.background = ''
      document.documentElement.style.background = ''
    }
  }, [])

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        border: '3px solid rgba(239,68,68,0.95)',
        borderRadius: 2,
        boxShadow: '0 0 18px rgba(239,68,68,0.45), inset 0 0 0 1px rgba(239,68,68,0.25)',
      }}
    />
  )
}

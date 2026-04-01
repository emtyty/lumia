import { useState, useEffect } from 'react'

/**
 * Reads a local file via IPC and returns a blob URL that supports Range requests
 * (required by <video> for seeking/buffering). Revokes the blob URL on cleanup.
 */
export function useLocalVideoUrl(filePath: string | undefined | null): string {
  const [blobUrl, setBlobUrl] = useState('')

  useEffect(() => {
    if (!filePath) return
    let url = ''
    window.electronAPI?.readLocalFile(filePath).then(buffer => {
      const blob = new Blob([buffer], { type: 'video/webm' })
      url = URL.createObjectURL(blob)
      setBlobUrl(url)
    })
    return () => {
      if (url) URL.revokeObjectURL(url)
      setBlobUrl('')
    }
  }, [filePath])

  return blobUrl
}

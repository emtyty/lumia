export {}

interface AppSettings {
  imgurClientId: string
  defaultSavePath: string
  customUploadUrl: string
  customUploadHeaders: Record<string, string>
  customUploadFieldName: string
  theme: 'dark' | 'light' | 'system'
  activeWorkflowId: string
  googleDriveRefreshToken: string
  googleDriveAccessToken: string
  googleDriveTokenExpiresAt: number
  googleDriveFolderId: string
  launchAtStartup: boolean
  historyRetentionDays: number
}

declare global {
  interface Window {
    electronAPI: {
      captureScreenshot: (mode: 'fullscreen' | 'region' | 'window' | 'active-monitor') => Promise<string | void>

      // Recording
      getRecordingSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>
      saveRecording: (buffer: ArrayBuffer, filename: string) => Promise<string>
      hideForRecording: () => Promise<void>
      showAfterRecording: () => Promise<void>

      runWorkflow: (templateId: string, imageData: string, destinationIndex?: number) => Promise<import('./types').WorkflowResult>
      runInlineAction: (actionType: 'clipboard' | 'save', imageData: string) => Promise<{ canceled?: boolean }>
      getTemplates: () => Promise<import('./types').WorkflowTemplate[]>
      saveTemplate: (template: import('./types').WorkflowTemplate) => Promise<import('./types').WorkflowTemplate>
      deleteTemplate: (id: string) => Promise<boolean>

      getHistory: () => Promise<import('./types').HistoryItem[]>
      deleteHistoryItem: (id: string) => Promise<boolean>
      openHistoryFile: (filePath: string) => Promise<void>
      addHistoryItem: (item: import('./types').HistoryItem) => Promise<void>

      getHotkeys: () => Promise<Record<string, string>>
      getSettings: () => Promise<AppSettings>
      setSetting: (key: keyof AppSettings, value: unknown) => Promise<void>

      gdriveStartAuth: () => Promise<{ success: boolean; error?: string }>
      gdriveDisconnect: () => Promise<{ success: boolean }>
      onGdriveConnected: (cb: () => void) => void

      saveFile: (dataUrl: string, filePath: string) => Promise<string>
      readLocalFile: (filePath: string) => Promise<ArrayBuffer>

      quitApp: () => Promise<void>
      toggleDevTools: () => Promise<void>
      reloadWindow: () => Promise<void>
      forceReloadWindow: () => Promise<void>
      setTitleBarTheme: (theme: 'dark' | 'light' | 'system') => Promise<void>
      navigate: (route: string) => void
      onCaptureReady: (cb: (data: { dataUrl: string; source: string }) => void) => void
      onNavigate: (cb: (route: string, state?: Record<string, unknown>) => void) => void
      onRegionSelected: (cb: (rect: { x: number; y: number; width: number; height: number }) => void) => void
      onRecorderOpen: (cb: () => void) => void
      onRecorderOpenGif: (cb: () => void) => void
      onRecorderStop: (cb: () => void) => void
      removeAllListeners: (channel: string) => void

      confirmRegion: (payload: { dataUrl: string; rect: { x: number; y: number; width: number; height: number } }) => Promise<void>
      cancelRegion: () => Promise<void>
      getWindowAt: (x: number, y: number) => Promise<{ x: number; y: number; width: number; height: number } | null>
      confirmWindowPick: (rect: { x: number; y: number; width: number; height: number }) => Promise<void>
      cancelWindowPick: () => Promise<void>
      confirmMonitorPick: () => Promise<void>
      cancelMonitorPick: () => Promise<void>
      switchOverlayMode: (mode: 'region' | 'window-pick' | 'monitor-pick') => Promise<void>
      onOverlayModeChanged: (cb: (mode: string) => void) => void
      onOverlaySetActive: (cb: (active: boolean) => void) => void
      overlayDrawing: (drawing: boolean) => void
      notifyRoute: (route: string) => void

      // OCR & Auto-Blur
      ocrScan: (dataUrl: string) => Promise<import('@/types').AutoBlurResult>
      ocrApplyBlur: (dataUrl: string, regions: import('@/types').SensitiveRegion[], blockSize?: number) => Promise<string>

      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<void>
      showSaveDialog: (opts: unknown) => Promise<{ filePath?: string; canceled: boolean }>
      showOpenDialog: (opts: unknown) => Promise<{ filePaths: string[]; canceled: boolean }>

      onUpdateDownloaded: (cb: (version: string) => void) => void
      installUpdate: () => Promise<void>
      getAppVersion: () => Promise<string>
      onAbout: (cb: () => void) => void

      platform: NodeJS.Platform

      // Scrolling capture
      startScrollCapture(opts?: {
        delay?: number; maxFrames?: number;
        scrollMethod?: 'mouseWheel' | 'vscroll' | 'downArrow' | 'pageDown';
        scrollToTopFirst?: boolean
      }): Promise<{ ok: boolean; error?: string }>
      cancelScrollCapture(): Promise<void>
      onScrollCaptureProgress(cb: (data: { frame: number; maxFrames: number; phase?: 'capturing' | 'stitching' }) => void): void
      onScrollCaptureResult(cb: (data: { dataUrl: string }) => void): void
      onScrollCaptureOpen(cb: () => void): void
      onScrollCaptureError(cb: (data: { error: string }) => void): void
      confirmScrollRegion(rect: { x: number; y: number; width: number; height: number }): Promise<void>
      cancelScrollRegion(): Promise<void>
      getOverlayMode(): Promise<'region' | 'scroll-region' | 'window-pick' | 'monitor-pick'>
    }
  }
}

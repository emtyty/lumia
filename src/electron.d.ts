export {}

interface AppSettings {
  imgurClientId: string
  defaultSavePath: string
  customUploadUrl: string
  customUploadHeaders: Record<string, string>
  customUploadFieldName: string
  theme: 'dark' | 'light'
  activeWorkflowId: string
}

declare global {
  interface Window {
    electronAPI: {
      captureScreenshot: (mode: 'fullscreen' | 'region' | 'window') => Promise<string | void>

      // Recording
      getRecordingSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>
      saveRecording: (buffer: ArrayBuffer, filename: string) => Promise<string>
      hideForRecording: () => Promise<void>
      showAfterRecording: () => Promise<void>

      runWorkflow: (templateId: string, imageData: string) => Promise<import('./types').WorkflowResult>
      getTemplates: () => Promise<import('./types').WorkflowTemplate[]>
      saveTemplate: (template: import('./types').WorkflowTemplate) => Promise<import('./types').WorkflowTemplate>
      deleteTemplate: (id: string) => Promise<boolean>

      getHistory: () => Promise<import('./types').HistoryItem[]>
      deleteHistoryItem: (id: string) => Promise<boolean>
      openHistoryFile: (filePath: string) => Promise<void>
      addHistoryItem: (item: import('./types').HistoryItem) => Promise<void>

      getSettings: () => Promise<AppSettings>
      setSetting: (key: keyof AppSettings, value: unknown) => Promise<void>

      saveFile: (dataUrl: string, filePath: string) => Promise<string>
      readLocalFile: (filePath: string) => Promise<ArrayBuffer>

      showAppMenu: () => Promise<void>
      setTitleBarTheme: (theme: 'dark' | 'light') => Promise<void>
      navigate: (route: string) => void
      onCaptureReady: (cb: (data: { dataUrl: string; source: string }) => void) => void
      onNavigate: (cb: (route: string, state?: Record<string, unknown>) => void) => void
      onRegionSelected: (cb: (rect: { x: number; y: number; width: number; height: number }) => void) => void
      onRecorderOpen: (cb: () => void) => void
      onRecorderOpenGif: (cb: () => void) => void
      onRecorderStop: (cb: () => void) => void
      removeAllListeners: (channel: string) => void

      confirmRegion: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>
      cancelRegion: () => Promise<void>

      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<void>
      showSaveDialog: (opts: unknown) => Promise<{ filePath?: string; canceled: boolean }>
      showOpenDialog: (opts: unknown) => Promise<{ filePaths: string[]; canceled: boolean }>

      platform: NodeJS.Platform
    }
  }
}

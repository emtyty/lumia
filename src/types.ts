export interface WorkflowTemplate {
  id: string
  name: string
  icon: string
  builtIn?: boolean
  afterCapture: AfterCaptureStep[]
  destinations: UploadDestination[]
  afterUpload: AfterUploadStep[]
}

export type AfterCaptureStep =
  | { type: 'annotate' }
  | { type: 'save'; path: string }
  | { type: 'clipboard' }

export type UploadDestination =
  | { type: 'imgur'; clientId: string }
  | { type: 'custom'; url: string; headers: Record<string, string>; fieldName?: string }

export type AfterUploadStep =
  | { type: 'copyUrl'; which: 'first' | 'all' }
  | { type: 'openUrl' }
  | { type: 'notify'; message?: string }
  | { type: 'osShare' }

export interface UploadResult {
  destination: string
  success: boolean
  url?: string
  error?: string
}

export interface WorkflowResult {
  templateId: string
  uploads: UploadResult[]
  savedPath?: string
  copiedToClipboard: boolean
}

export interface HistoryItem {
  id: string
  timestamp: number
  name: string
  filePath?: string
  dataUrl?: string
  thumbnailUrl?: string
  size?: number
  type: 'screenshot' | 'recording'
  uploads: UploadResult[]
}

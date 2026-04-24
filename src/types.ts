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
  | { type: 'google-drive'; folderId?: string }
  | { type: 'r2'; bucket?: string }

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
  // Set by main on history:get when filePath is missing from disk. Never
  // persisted — the store keeps items even when files are gone so the user
  // can clean them up explicitly.
  fileMissing?: boolean
}

// ── OCR & Auto-Blur ──────────────────────────────────────────────

export type SensitiveCategory =
  | 'email'
  | 'phone'
  | 'credit-card'
  | 'ssn'
  | 'api-key'
  | 'jwt'
  | 'private-key'
  | 'password'
  | 'bearer-token'
  | 'ip-address'
  | 'url-credentials'

export interface SensitiveRegion {
  id: string
  category: SensitiveCategory
  text: string
  bbox: { x: number; y: number; width: number; height: number }
}

export interface AutoBlurResult {
  regions: SensitiveRegion[]
  ocrTimeMs: number
  detectTimeMs: number
}

import { clipboard, nativeImage, shell, Notification } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { TemplateStore } from './templates'
import type { WorkflowResult, UploadResult, UploadDestination } from './types'
import { uploadToImgur } from './uploaders/imgur'
import { uploadToCustom } from './uploaders/custom'
import { uploadToGoogleDrive, refreshGoogleToken } from './uploaders/googledrive'
import { HistoryStore } from './history'
import { getSettings } from './settings'
import { getMainWindow } from './index'
import { v4 as uuidv4 } from 'uuid'

export class WorkflowEngine {
  private historyStore = new HistoryStore()

  constructor(private templateStore: TemplateStore) {}

  async run(templateId: string, imageData: string): Promise<WorkflowResult> {
    const template = this.templateStore.getById(templateId)
    if (!template) throw new Error(`Template not found: ${templateId}`)

    const result: WorkflowResult = {
      templateId,
      uploads: [],
      copiedToClipboard: false
    }

    // ── After-capture phase (sequential) ──
    for (const step of template.afterCapture) {
      if (step.type === 'clipboard') {
        const img = nativeImage.createFromDataURL(imageData)
        clipboard.writeImage(img)
        result.copiedToClipboard = true
      }

      if (step.type === 'save') {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `capture-${ts}.png`
        const dir = step.path && step.path.trim()
          ? step.path
          : getSettings().defaultSavePath || join(homedir(), 'Pictures', 'ShareAnywhere')
        await mkdir(dir, { recursive: true })
        const filePath = join(dir, filename)
        const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')
        await writeFile(filePath, Buffer.from(base64, 'base64'))
        result.savedPath = filePath
      }

      // 'annotate' is handled by the renderer before calling workflow:run
    }

    // ── Upload phase (parallel) ──
    if (template.destinations.length > 0) {
      const uploadResults = await Promise.allSettled(
        template.destinations.map(dest => this.upload(dest, imageData))
      )

      result.uploads = uploadResults.map((r, i) => {
        const dest = template.destinations[i]
        if (r.status === 'fulfilled') return r.value
        return {
          destination: dest.type,
          success: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        }
      })
    }

    // ── After-upload phase (sequential) ──
    const successUrls = result.uploads.filter(u => u.success && u.url).map(u => u.url!)

    for (const step of template.afterUpload) {
      if (step.type === 'copyUrl' && successUrls.length > 0) {
        const text = step.which === 'all' ? successUrls.join('\n') : successUrls[0]
        clipboard.writeText(text)
      }

      if (step.type === 'openUrl' && successUrls[0]) {
        shell.openExternal(successUrls[0])
      }

      if (step.type === 'osShare' && result.savedPath) {
        shell.openPath(result.savedPath)
      }

      if (step.type === 'notify') {
        const uploaded = result.uploads.filter(u => u.success).length
        const failed = result.uploads.filter(u => !u.success).length
        const parts: string[] = []
        if (result.copiedToClipboard) parts.push('Copied to clipboard')
        if (result.savedPath) parts.push('Saved to disk')
        if (uploaded > 0) parts.push(`Uploaded to ${uploaded} destination${uploaded > 1 ? 's' : ''}`)
        if (failed > 0) parts.push(`${failed} upload${failed > 1 ? 's' : ''} failed`)

        new Notification({
          title: 'ShareAnywhere',
          body: parts.join(' · ') || 'Capture complete'
        }).show()
      }
    }

    // ── Save to history ──
    this.historyStore.add({
      id: uuidv4(),
      timestamp: Date.now(),
      name: `capture-${new Date().toLocaleString()}`,
      dataUrl: imageData,
      filePath: result.savedPath,
      type: 'screenshot',
      uploads: result.uploads
    })

    // Send result to renderer for the upload summary toast
    getMainWindow()?.webContents.send('workflow:result', result)

    return result
  }

  private async upload(dest: UploadDestination, imageData: string): Promise<UploadResult> {
    switch (dest.type) {
      case 'imgur': return uploadToImgur(imageData, dest.clientId)
      case 'custom': return uploadToCustom(imageData, dest.url, dest.headers, dest.fieldName)
      case 'google-drive': return this.uploadToGoogleDrive(imageData, dest.folderId)
    }
  }

  private async uploadToGoogleDrive(imageData: string, folderId?: string): Promise<UploadResult> {
    const settings = getSettings()
    let { googleDriveAccessToken } = settings
    const { googleDriveClientId, googleDriveClientSecret, googleDriveRefreshToken, googleDriveTokenExpiresAt } = settings

    // Auto-refresh token if expired
    if (googleDriveRefreshToken && Date.now() >= googleDriveTokenExpiresAt - 60_000) {
      try {
        const refreshed = await refreshGoogleToken(googleDriveClientId, googleDriveClientSecret, googleDriveRefreshToken)
        googleDriveAccessToken = refreshed.accessToken
        const { setSetting } = await import('./settings')
        setSetting('googleDriveAccessToken', refreshed.accessToken)
        setSetting('googleDriveTokenExpiresAt', refreshed.expiresAt)
      } catch (err) {
        return { destination: 'google-drive', success: false, error: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}` }
      }
    }

    const folder = folderId || settings.googleDriveFolderId || undefined
    return uploadToGoogleDrive(imageData, googleDriveAccessToken, folder)
  }
}

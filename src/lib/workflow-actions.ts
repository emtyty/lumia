import type { WorkflowTemplate } from '../types'

export interface ActionBtn {
  key: string
  icon: string
  label: string
  templateId: string
  destinationIndex?: number
  primary?: boolean
  actionType?: 'clipboard' | 'save'
}

export const DEST_META: Record<string, { icon: string; label: string }> = {
  imgur:         { icon: 'link',         label: 'Imgur' },
  'google-drive':{ icon: 'add_to_drive', label: 'Google Drive' },
  r2:            { icon: 'share',        label: 'Lumia' },
  custom:        { icon: 'upload',       label: 'Upload' },
}

/** Destinations known to handle video uploads. GDrive/Imgur/Custom still
 *  assume image data URLs, so we hide them in video mode until their
 *  uploaders grow file-buffer support. */
const VIDEO_CAPABLE_DESTINATIONS = new Set(['r2'])

/** Map a workflow template's steps + destinations into the button list that
 *  drives the Editor header actions. Destinations are filtered out when their
 *  credentials are missing (image mode) or when they can't yet handle video
 *  (video mode), so the UI never offers an action that would fail on click. */
export function deriveActions(
  tpl: WorkflowTemplate | undefined,
  gdriveConnected: boolean,
  imgurConfigured: boolean,
  customConfigured: boolean,
  kind: 'image' | 'video' = 'image',
): ActionBtn[] {
  if (!tpl) return []
  const btns: ActionBtn[] = []
  for (const step of tpl.afterCapture) {
    if (step.type === 'clipboard') {
      btns.push({ key: 'clipboard', icon: 'content_copy', label: 'Copy', templateId: tpl.id, actionType: 'clipboard' })
    } else if (step.type === 'save') {
      btns.push({ key: 'save', icon: 'save', label: 'Save', templateId: tpl.id, actionType: 'save' })
    }
  }
  for (let i = 0; i < tpl.destinations.length; i++) {
    const dest = tpl.destinations[i]
    if (kind === 'video' && !VIDEO_CAPABLE_DESTINATIONS.has(dest.type)) continue
    if (dest.type === 'google-drive' && !gdriveConnected) continue
    if (dest.type === 'imgur' && !imgurConfigured) continue
    if (dest.type === 'custom' && !customConfigured) continue
    const meta = DEST_META[dest.type] ?? { icon: 'cloud_upload', label: dest.type }
    btns.push({
      key: `dest-${i}-${dest.type}`,
      icon: meta.icon,
      label: meta.label,
      templateId: tpl.id,
      destinationIndex: i,
      primary: true,
    })
  }
  return btns
}

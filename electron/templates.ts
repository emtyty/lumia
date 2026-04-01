import Store from 'electron-store'
import { v4 as uuidv4 } from 'uuid'
import type { WorkflowTemplate } from './types'
import { homedir } from 'os'
import { join } from 'path'

const defaultSavePath = join(homedir(), 'Pictures', 'ShareAnywhere')

const BUILT_IN: WorkflowTemplate[] = [
  {
    id: 'builtin-clipboard',
    name: 'Quick Clipboard',
    icon: '📋',
    builtIn: true,
    afterCapture: [{ type: 'clipboard' }],
    destinations: [],
    afterUpload: [{ type: 'notify' }]
  },
  {
    id: 'builtin-save',
    name: 'Save to Disk',
    icon: '💾',
    builtIn: true,
    afterCapture: [
      { type: 'annotate' },
      { type: 'save', path: defaultSavePath }
    ],
    destinations: [],
    afterUpload: [{ type: 'notify' }]
  },
  {
    id: 'builtin-imgur',
    name: 'Upload & Copy Link',
    icon: '🔗',
    builtIn: true,
    afterCapture: [{ type: 'annotate' }],
    destinations: [{ type: 'imgur', clientId: '' }],
    afterUpload: [
      { type: 'copyUrl', which: 'first' },
      { type: 'notify' }
    ]
  },
  {
    id: 'builtin-fullshare',
    name: 'Full Share',
    icon: '🚀',
    builtIn: true,
    afterCapture: [
      { type: 'annotate' },
      { type: 'save', path: defaultSavePath }
    ],
    destinations: [{ type: 'imgur', clientId: '' }],
    afterUpload: [
      { type: 'copyUrl', which: 'first' },
      { type: 'osShare' },
      { type: 'notify' }
    ]
  }
]

export class TemplateStore {
  private store: Store<{ templates: WorkflowTemplate[] }>

  constructor() {
    this.store = new Store<{ templates: WorkflowTemplate[] }>({
      name: 'templates',
      defaults: { templates: [] }
    })
  }

  getAll(): WorkflowTemplate[] {
    const user = this.store.get('templates')
    return [...BUILT_IN, ...user]
  }

  save(template: WorkflowTemplate): WorkflowTemplate {
    const user = this.store.get('templates')
    if (!template.id) template.id = uuidv4()
    const idx = user.findIndex(t => t.id === template.id)
    if (idx >= 0) user[idx] = template
    else user.push(template)
    this.store.set('templates', user)
    return template
  }

  delete(id: string): boolean {
    const user = this.store.get('templates')
    const filtered = user.filter(t => t.id !== id)
    if (filtered.length === user.length) return false
    this.store.set('templates', filtered)
    return true
  }

  getById(id: string): WorkflowTemplate | undefined {
    return this.getAll().find(t => t.id === id)
  }
}

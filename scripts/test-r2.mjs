/**
 * Quick R2 upload test — runs outside Electron to diagnose auth errors.
 * Usage: node scripts/test-r2.mjs
 * Reads credentials from .env (same file the app uses).
 */
import { createHmac, createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// ── Load .env manually (no dotenv dep needed) ────────────────────────────────
const envPath = join(root, '.env')
let envVars = {}
try {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    envVars[key] = val
  }
} catch {
  console.error('❌  Could not read .env — make sure it exists at project root')
  process.exit(1)
}

const ACCOUNT_ID  = envVars['MAIN_VITE_R2_ACCOUNT_ID']        || ''
const ACCESS_KEY  = envVars['MAIN_VITE_R2_ACCESS_KEY_ID']     || ''
const SECRET_KEY  = envVars['MAIN_VITE_R2_SECRET_ACCESS_KEY'] || ''
const BUCKET      = envVars['MAIN_VITE_R2_BUCKET']            || ''
const PUBLIC_URL  = envVars['MAIN_VITE_R2_PUBLIC_URL']        || ''

console.log('\n🔍  Credentials loaded from .env:')
console.log('  ACCOUNT_ID :', ACCOUNT_ID  || '(empty)')
console.log('  ACCESS_KEY :', ACCESS_KEY  ? ACCESS_KEY.slice(0, 8) + '…' : '(empty)')
console.log('  SECRET_KEY :', SECRET_KEY  ? SECRET_KEY.slice(0, 8) + '…' : '(empty)')
console.log('  BUCKET     :', BUCKET      || '(empty)')
console.log('  PUBLIC_URL :', PUBLIC_URL  || '(empty)')

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
  console.error('\n❌  Missing credentials — fill in .env first\n')
  process.exit(1)
}

// ── Tiny 1×1 red PNG (base64) ─────────────────────────────────────────────
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=='

// ── AWS Sig v4 helpers ────────────────────────────────────────────────────
function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex')
}
function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}
function getSigningKey(secret, date, region, service) {
  return hmacSha256(hmacSha256(hmacSha256(hmacSha256('AWS4' + secret, date), region), service), 'aws4_request')
}

// ── Upload ────────────────────────────────────────────────────────────────
const buffer      = Buffer.from(TINY_PNG_B64, 'base64')
const key         = `test/${Date.now()}.png`
const host        = `${ACCOUNT_ID}.r2.cloudflarestorage.com`
const url         = `https://${host}/${BUCKET}/${key}`
const now         = new Date()
const datestamp   = now.toISOString().slice(0, 10).replace(/-/g, '')
const amzdate     = datestamp + 'T' + now.toISOString().slice(11, 19).replace(/:/g, '') + 'Z'
const contentType = 'image/png'
const payloadHash = sha256hex(buffer)

const canonicalHeaders =
  `content-type:${contentType}\n` +
  `host:${host}\n` +
  `x-amz-content-sha256:${payloadHash}\n` +
  `x-amz-date:${amzdate}\n`

const signedHeaders    = 'content-type;host;x-amz-content-sha256;x-amz-date'
const canonicalRequest = ['PUT', `/${BUCKET}/${key}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
const credentialScope  = `${datestamp}/auto/s3/aws4_request`
const stringToSign     = ['AWS4-HMAC-SHA256', amzdate, credentialScope, sha256hex(canonicalRequest)].join('\n')
const signingKey       = getSigningKey(SECRET_KEY, datestamp, 'auto', 's3')
const signature        = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
const authorization    =
  `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, ` +
  `SignedHeaders=${signedHeaders}, Signature=${signature}`

console.log('\n📤  Uploading test PNG to:', url)

try {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type':         contentType,
      'Host':                 host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date':          amzdate,
      'Authorization':        authorization,
    },
    body: buffer
  })

  const body = await res.text()

  if (res.ok) {
    const publicUrl = PUBLIC_URL ? `${PUBLIC_URL.replace(/\/$/, '')}/${key}` : '(no public URL configured)'
    console.log('\n✅  Upload successful!')
    console.log('   Public URL:', publicUrl)
  } else {
    console.error(`\n❌  HTTP ${res.status} ${res.statusText}`)
    console.error('   Response body:')
    console.error('  ', body)
  }
} catch (err) {
  console.error('\n❌  Network error:', err.message)
}

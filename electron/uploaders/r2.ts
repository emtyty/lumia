import { createHmac, createHash } from 'crypto'
import { net } from 'electron'
import type { UploadResult } from '../types'

function sha256hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function getSigningKey(secretKey: string, datestamp: string, region: string, service: string): Buffer {
  const kDate    = hmacSha256('AWS4' + secretKey, datestamp)
  const kRegion  = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

function netFetch(url: string, opts: { method: string; headers: Record<string, string>; body: Buffer }): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: opts.method, useSessionCookies: false })

    for (const [k, v] of Object.entries(opts.headers)) {
      req.setHeader(k, v)
    }

    req.on('response', res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => body
        })
      })
      res.on('error', reject)
    })

    req.on('error', reject)
    req.write(opts.body)
    req.end()
  })
}

export async function uploadToR2(
  imageData: string,
  accountId: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  publicUrlBase?: string
): Promise<UploadResult> {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return { destination: 'r2', success: false, error: 'R2 credentials are not configured' }
  }

  const base64 = imageData.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')

  const key = `captures/${Date.now()}.png`
  const host = `${accountId}.r2.cloudflarestorage.com`
  const url  = `https://${host}/${bucket}/${key}`

  const now        = new Date()
  const datestamp  = now.toISOString().slice(0, 10).replace(/-/g, '')
  const amzdate    = datestamp + 'T' + now.toISOString().slice(11, 19).replace(/:/g, '') + 'Z'

  const region      = 'auto'
  const service     = 's3'
  const contentType = 'image/png'
  const payloadHash = sha256hex(buffer)

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzdate}\n`

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzdate,
    credentialScope,
    sha256hex(canonicalRequest)
  ].join('\n')

  const signingKey  = getSigningKey(secretAccessKey, datestamp, region, service)
  const signature   = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  try {
    const response = await netFetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type':          contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date':           amzdate,
        'Authorization':         authorization,
      },
      body: buffer
    })

    if (!response.ok) {
      const text = await response.text()
      return { destination: 'r2', success: false, error: `HTTP ${response.status}: ${text}` }
    }

    const publicUrl = publicUrlBase
      ? `${publicUrlBase.replace(/\/$/, '')}/${key}`
      : undefined

    return { destination: 'r2', success: true, url: publicUrl }
  } catch (err) {
    return { destination: 'r2', success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

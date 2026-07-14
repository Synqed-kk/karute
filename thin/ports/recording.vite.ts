// RecordingPipelinePort — thin (Vite) implementation (packet 08 Decision 2). No
// supabase-js: the facade mints a service-role signed UPLOAD url
// (POST /recordings/upload-url), the shell PUTs the blob straight to storage with
// plain fetch, and transcription runs by PATH against the /api/app/v1/ai twin
// (the server verifies the tenant prefix + deletes the object after — so there is
// no client-side cleanup).

import type { RecordingPipelinePort } from '@/lib/ports/recording-port'
import { getDataPort } from '@/lib/ports/data-port'

export const viteRecordingPort: RecordingPipelinePort = {
  aiBase: '/api/app/v1/ai',
  async prepareTranscription(blob) {
    // 1. Service-minted signed upload URL (tenant-prefixed path).
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/upload-url', {
      method: 'POST',
    })
    if (!res.ok) throw new Error(`Upload URL failed (${res.status})`)
    const { path, url } = (await res.json()) as { path: string; url: string }

    // 2. PUT the blob directly to storage (the signed URL carries the token).
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: blob,
    })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)

    // 3. Transcribe by PATH; the server deletes the object after — no cleanup here.
    return { body: { path }, cleanup: () => {} }
  },
}

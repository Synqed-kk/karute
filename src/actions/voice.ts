'use server'

// Staff voice enrollment — the REAL backend behind VoiceEnrollmentDialog
// (which was a UI stub: fake timer, audio discarded). Plaud's pattern, done
// properly: consent → save the sample → deletable anytime. The sample lives
// in the recordings bucket; enrollment state lives in the org-settings blob
// (zero-migration path). When the Stage-1 matching engine is chosen
// (docs/diarization-stack.md bake-off), samples convert to voice embeddings
// and the raw audio is deleted — every voice saved now starts working in
// transcription automatically at that moment.

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'
import { getOrgSettings, upsertOrgSettings } from './org-settings'

const MAX_SAMPLE_BYTES = 3 * 1024 * 1024 // ~15s of opus is well under this

export async function enrollVoiceAction(
  staffId: string,
  formData: FormData,
): Promise<{ ok: boolean; enrolledAt?: string }> {
  try {
    const audio = formData.get('audio')
    if (!staffId || !(audio instanceof File)) return { ok: false }
    if (audio.size === 0 || audio.size > MAX_SAMPLE_BYTES) return { ok: false }
    if (audio.type && !audio.type.startsWith('audio/')) return { ok: false }

    const businessId = await getBusinessId()
    if (!businessId) return { ok: false }
    const samplePath = `voice-enroll/${businessId}/${staffId}.webm`

    const supabase = createServiceClient()
    const { error } = await supabase.storage
      .from('recordings')
      .upload(samplePath, audio, { upsert: true, contentType: audio.type || 'audio/webm' })
    if (error) return { ok: false }

    const settings = await getOrgSettings()
    const enrolledAt = new Date().toISOString()
    const next = {
      ...(settings?.voice_enrollments ?? {}),
      [staffId]: {
        consent_at: enrolledAt,
        sample_path: samplePath,
        status: 'saved' as const,
        revoked_at: null,
      },
    }
    const saved = await upsertOrgSettings({ voice_enrollments: next })
    if (!saved) return { ok: false }
    revalidatePath('/[locale]/(app)/settings', 'page')
    return { ok: true, enrolledAt }
  } catch {
    return { ok: false }
  }
}

/** The delete button — removes the stored sample AND records the revocation
 *  (status + timestamp kept as the audit trail; the audio itself is gone). */
export async function revokeVoiceAction(staffId: string): Promise<{ ok: boolean }> {
  try {
    if (!staffId) return { ok: false }
    const settings = await getOrgSettings()
    const current = settings?.voice_enrollments?.[staffId]
    if (!current) return { ok: false }

    if (current.sample_path) {
      const supabase = createServiceClient()
      await supabase.storage.from('recordings').remove([current.sample_path])
    }
    const next = {
      ...(settings?.voice_enrollments ?? {}),
      [staffId]: {
        ...current,
        sample_path: '',
        status: 'revoked' as const,
        revoked_at: new Date().toISOString(),
      },
    }
    const saved = await upsertOrgSettings({ voice_enrollments: next })
    if (!saved) return { ok: false }
    revalidatePath('/[locale]/(app)/settings', 'page')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

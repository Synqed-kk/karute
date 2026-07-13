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
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getOrgSettings, writeOrgSettingsBlob } from './org-settings'

const MAX_SAMPLE_BYTES = 3 * 1024 * 1024 // ~15s of opus is well under this

/**
 * Voice ownership gate (packet 03, gap 2). The action trusted a caller-supplied
 * `staffId` and wrote the enrollment for THAT id — so a request could overwrite
 * or delete another staffer's voice sample. Rule: a staffer may act only on
 * their OWN voice; owner/manager (`staff.manage`) may act on anyone's. Returns
 * false (never throws) to keep the {ok:boolean} action contract.
 */
async function assertVoiceOwnership(targetStaffId: string): Promise<boolean> {
  const caller = await getCurrentUserStaffId()
  if (!caller) return false
  if (caller === targetStaffId) return true
  return (await getMyCapabilities()).has('staff.manage')
}

export async function enrollVoiceAction(
  staffId: string,
  formData: FormData,
): Promise<{ ok: boolean; enrolledAt?: string }> {
  try {
    const audio = formData.get('audio')
    if (!staffId || !(audio instanceof File)) return { ok: false }
    if (!(await assertVoiceOwnership(staffId))) return { ok: false }
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

    // ≤10s reference derivative (the dialog assembles it from the first
    // timeslice chunks) — what the speaker-id engine actually consumes.
    const audioRef = formData.get('audioRef')
    let refPath: string | undefined
    if (audioRef instanceof File && audioRef.size > 0 && audioRef.size <= MAX_SAMPLE_BYTES) {
      refPath = `voice-enroll/${businessId}/${staffId}.ref10s.webm`
      const { error: refError } = await supabase.storage
        .from('recordings')
        .upload(refPath, audioRef, { upsert: true, contentType: audioRef.type || 'audio/webm' })
      if (refError) refPath = undefined
    }

    const settings = await getOrgSettings()
    const enrolledAt = new Date().toISOString()
    const next = {
      ...(settings?.voice_enrollments ?? {}),
      [staffId]: {
        consent_at: enrolledAt,
        sample_path: samplePath,
        ...(refPath ? { ref_path: refPath } : {}),
        status: 'saved' as const,
        revoked_at: null,
      },
    }
    const saved = await writeOrgSettingsBlob({ voice_enrollments: next })
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
    if (!(await assertVoiceOwnership(staffId))) return { ok: false }
    const settings = await getOrgSettings()
    const current = settings?.voice_enrollments?.[staffId]
    if (!current) return { ok: false }

    const paths = [current.sample_path, current.ref_path].filter(
      (p): p is string => !!p,
    )
    if (paths.length > 0) {
      const supabase = createServiceClient()
      await supabase.storage.from('recordings').remove(paths)
    }
    const next = {
      ...(settings?.voice_enrollments ?? {}),
      [staffId]: {
        ...current,
        sample_path: '',
        ref_path: undefined,
        status: 'revoked' as const,
        revoked_at: new Date().toISOString(),
      },
    }
    const saved = await writeOrgSettingsBlob({ voice_enrollments: next })
    if (!saved) return { ok: false }
    revalidatePath('/[locale]/(app)/settings', 'page')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

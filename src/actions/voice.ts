'use server'

// Staff voice enrollment — the REAL backend behind VoiceEnrollmentDialog
// (which was a UI stub: fake timer, audio discarded). Plaud's pattern, done
// properly: consent → save the sample → deletable anytime. The sample lives
// in the recordings bucket; enrollment state lives in the org-settings blob
// (zero-migration path). When the Stage-1 matching engine is chosen
// (docs/diarization-stack.md bake-off), samples convert to voice embeddings
// and the raw audio is deleted — every voice saved now starts working in
// transcription automatically at that moment.
//
// Cores below are extracted design-parity packet 12 §S4a (T1's no-twin
// list) — their ROUTES are S4b (packet T4); nothing here is reachable over
// the facade yet, but the split is done now so S4b only has to add routes.

import { revalidatePath } from 'next/cache'
import type { SynqedClient } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'
import { audit } from '@/lib/audit'
import { resolveWebActorId } from '@/lib/audit-web'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import type { Capability } from '@/lib/auth/permissions'
import { orgSettingsWithClient, writeOrgSettingsBlobWithClient } from './org-settings'

const MAX_SAMPLE_BYTES = 3 * 1024 * 1024 // ~15s of opus is well under this

// Explicit-client seam (design-parity packet 12 §S4a — the P-B pattern):
// every core below takes this instead of resolving org settings from the
// cookie session, so a future facade route (S4b) can reuse the exact write
// logic with a Bearer-resolved client.
type VoiceClient = Pick<SynqedClient, 'orgSettings'>

/** Identity a voice write core needs, explicit instead of cookie-resolved:
 *  selfUserId + callerCapabilities carry the ownership gate (self OR
 *  staff.manage — the voice-isolation rule); actorId + source feed the
 *  moved-in audit row. */
type VoiceWriteDeps = {
  selfUserId: string | null
  callerCapabilities: Set<Capability>
  actorId: string | null
  source: 'web' | 'facade'
}

/**
 * Voice ownership gate (packet 03, gap 2). A staffer may act only on their
 * OWN voice; owner/manager (`staff.manage`) may act on anyone's. Pure —
 * takes the already-resolved caller identity instead of looking it up, so
 * web and a future facade route share the identical rule.
 */
function canActOnVoice(targetStaffId: string, deps: VoiceWriteDeps): boolean {
  return deps.selfUserId === targetStaffId || deps.callerCapabilities.has('staff.manage')
}

/** Client-threaded core of enrollVoiceAction (design-parity packet 12 §S4a).
 *  businessId is REQUIRED (it's part of the storage path, not just the audit
 *  row) — an unresolvable businessId fails closed ({ok:false}), same as the
 *  pre-split web action's own `if (!businessId) return { ok: false }`. */
export async function enrollVoiceActionCore(
  synqed: VoiceClient,
  businessId: string,
  deps: VoiceWriteDeps,
  staffId: string,
  formData: FormData,
): Promise<{ ok: boolean; enrolledAt?: string }> {
  try {
    const audio = formData.get('audio')
    if (!staffId || !(audio instanceof File)) return { ok: false }
    if (!canActOnVoice(staffId, deps)) return { ok: false }
    if (audio.size === 0 || audio.size > MAX_SAMPLE_BYTES) return { ok: false }
    if (audio.type && !audio.type.startsWith('audio/')) return { ok: false }
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

    const settings = await orgSettingsWithClient(synqed)
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
    const saved = await writeOrgSettingsBlobWithClient(synqed, { voice_enrollments: next })
    if (!saved) return { ok: false }
    audit({
      category: 'privacy',
      action: 'privacy.voice_enroll',
      severity: 'notice',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      source: deps.source,
    })
    return { ok: true, enrolledAt }
  } catch {
    return { ok: false }
  }
}

export async function enrollVoiceAction(
  staffId: string,
  formData: FormData,
): Promise<{ ok: boolean; enrolledAt?: string }> {
  try {
    const [businessId, synqed, selfUserId, callerCapabilities] = await Promise.all([
      getBusinessId(),
      getSynqedClient(),
      getCurrentUserStaffId(),
      getMyCapabilities(),
    ])
    const actorId = await resolveWebActorId()
    const result = await enrollVoiceActionCore(
      synqed,
      businessId,
      { selfUserId, callerCapabilities, actorId, source: 'web' },
      staffId,
      formData,
    )
    if (result.ok) revalidatePath('/[locale]/(app)/settings', 'page')
    return result
  } catch {
    return { ok: false }
  }
}

/** Client-threaded core of revokeVoiceAction (design-parity packet 12 §S4a).
 *  See enrollVoiceActionCore's doc comment for the shared client/deps seam. */
export async function revokeVoiceActionCore(
  synqed: VoiceClient,
  businessId: string,
  deps: VoiceWriteDeps,
  staffId: string,
): Promise<{ ok: boolean }> {
  try {
    if (!staffId) return { ok: false }
    if (!canActOnVoice(staffId, deps)) return { ok: false }
    const settings = await orgSettingsWithClient(synqed)
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
    const saved = await writeOrgSettingsBlobWithClient(synqed, { voice_enrollments: next })
    if (!saved) return { ok: false }
    audit({
      category: 'privacy',
      action: 'privacy.voice_revoke',
      severity: 'notice',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      source: deps.source,
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** The delete button — removes the stored sample AND records the revocation
 *  (status + timestamp kept as the audit trail; the audio itself is gone). */
export async function revokeVoiceAction(staffId: string): Promise<{ ok: boolean }> {
  try {
    const [businessId, synqed, selfUserId, callerCapabilities] = await Promise.all([
      getBusinessId(),
      getSynqedClient(),
      getCurrentUserStaffId(),
      getMyCapabilities(),
    ])
    const actorId = await resolveWebActorId()
    const result = await revokeVoiceActionCore(
      synqed,
      businessId,
      { selfUserId, callerCapabilities, actorId, source: 'web' },
      staffId,
    )
    if (result.ok) revalidatePath('/[locale]/(app)/settings', 'page')
    return result
  } catch {
    return { ok: false }
  }
}

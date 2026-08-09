'use client'

import { uploadCustomerPhoto, deleteCustomerPhoto } from '@/actions/customers'
import { globalRecorder } from '@/lib/global-recorder'

export type SessionPhotoStatus = 'uploading' | 'done' | 'error'

export interface SessionPhoto {
  id: string
  objectUrl: string
  status: SessionPhotoStatus
  file: File
  category: string
  customerId: string
  /** synqed-core's photo id after a successful upload — null until 'done'.
   *  The D3 discard-dialog delete loop keys off this. */
  serverId: string | null
  /** D2: whether recording consent existed at the MOMENT this photo was
   *  captured (not re-read later) — consent granted mid-session applies only
   *  to photos taken after. */
  takenWithConsent: boolean
}

type Listener = () => void

/**
 * In-session photo strip — module singleton mirroring global-recorder's
 * subscribe/notify pattern (see lib/global-recorder.ts) so SessionPhotoCard
 * can useSyncExternalStore it the same way use-global-recorder does.
 *
 * Upload failures only flip that photo's own status — never thrown, never
 * awaited by anything on the recorder's own start/stop path.
 */
class SessionPhotoStore {
  photos: SessionPhoto[] = []
  private listeners = new Set<Listener>()
  /** Photo id -> customerId, for D3's 写真も削除 choice catching an
   *  'uploading' photo whose upload hasn't resolved yet (§7). discard's
   *  clear() WIPES `photos` before that upload can settle, so this map is
   *  separate and survives the wipe — setStatus checks it on every settle
   *  and fires the delete itself once the photo actually lands (or drops
   *  the mark on 'error', where there is nothing server-side to delete). */
  private pendingDelete = new Map<string, { customerId: string; onFail?: () => void }>()

  constructor() {
    // Both discard() and the save handoff (RecordPageView's handleUseRecording
    // → discardRecording) route through GlobalRecorder.state === 'idle' —
    // reacting there covers both. Guard on photos.length so an idle-to-idle
    // notify (nothing to clear) doesn't fire a no-op re-render.
    globalRecorder.subscribe(() => {
      if (globalRecorder.state === 'idle' && this.photos.length > 0) this.clear()
    })
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    this.listeners.forEach((fn) => fn())
  }

  addPhoto(
    file: File,
    category: string,
    customerId: string,
    opts: { takenWithConsent: boolean },
  ) {
    const photo: SessionPhoto = {
      id: randomId(),
      objectUrl: URL.createObjectURL(file),
      status: 'uploading',
      file,
      category,
      customerId,
      serverId: null,
      takenWithConsent: opts.takenWithConsent,
    }
    this.photos = [...this.photos, photo]
    this.notify()
    void this.upload(photo)
  }

  retry(id: string) {
    const photo = this.photos.find((p) => p.id === id)
    // Status guard closes the double-fire window (blind-round P2): the first
    // tap flips to 'uploading' synchronously, so a racing second tap on the
    // same thumbnail no-ops instead of double-uploading one capture.
    if (!photo || photo.status !== 'error') return
    this.setStatus(id, 'uploading')
    void this.upload(photo)
  }

  /** D3 §7: mark an in-flight 'uploading' photo for delete-after-settle —
   *  called by the discard dialog's 写真も削除 choice for any photo that
   *  hasn't resolved yet. customerId is captured NOW because `photos` (and
   *  this photo's entry in it) may be gone by the time the upload settles.
   *  onFail fires when that settled delete FAILS — the caller owns the message
   *  (i18n lives in React), so the closure carries its own t(). */
  markDeleteAfterSettle(id: string, customerId: string, onFail?: () => void) {
    this.pendingDelete.set(id, { customerId, onFail })
  }

  private setStatus(id: string, status: SessionPhotoStatus, serverId: string | null = null) {
    this.photos = this.photos.map((p) => (p.id === id ? { ...p, status, serverId } : p))
    this.notify()
    const pending = this.pendingDelete.get(id)
    if (pending !== undefined) {
      this.pendingDelete.delete(id)
      // 'error': the upload never landed server-side — nothing to delete.
      if (status === 'done' && serverId) {
        // deleteCustomerPhoto never throws (it catches internally and resolves
        // { success: false }) — so the failure is only visible HERE. Report it
        // through onFail, the same toast the done-photos loop fires; swallowing
        // it left the staff believing a discarded photo was deleted.
        void deleteCustomerPhoto(pending.customerId, serverId).then((r) => {
          if (!r.success) pending.onFail?.()
        })
      }
    }
  }

  private async upload(photo: SessionPhoto) {
    try {
      // Linkage stamping (PR 9b §①): reuse global-recorder's OWN mint +
      // staleness guard exactly as the save path does (awaitRecordingSessionId
      // — pending mint → await it briefly; failed/null/stale-generation →
      // resolves null and this upload proceeds WITHOUT the field, fail-open,
      // same contract as handleUseRecording). No separate staleness tracking
      // needed here: by the time any upload() runs (initial or retry), the
      // store would already have been cleared if the session had ended
      // (globalRecorder going idle clears every photo — see the constructor
      // above), so the recorder singleton can only ever reflect THIS photo's
      // own session while this call is in flight.
      const recordingSessionId = await globalRecorder.awaitRecordingSessionId()
      const fd = new FormData()
      fd.append('file', photo.file)
      fd.append('category', photo.category)
      // '' is not a session (9a's parse rule) — only append when non-empty.
      if (recordingSessionId) fd.append('recording_session_id', recordingSessionId)
      fd.append('taken_with_consent', String(photo.takenWithConsent))
      const result = await uploadCustomerPhoto(photo.customerId, fd)
      if (result && 'error' in result) {
        this.setStatus(photo.id, 'error')
      } else {
        this.setStatus(photo.id, 'done', result.photo.id)
      }
    } catch {
      this.setStatus(photo.id, 'error')
    }
  }

  private clear() {
    // Honest-loss disclosure (blind-round P1): a failed-upload ('error')
    // photo exists ONLY in this strip — dropping it here without a word
    // would be silent data loss. The toast itself now lives in
    // RecordPageView (i18n'd, PR 9b §9) — it computes the error count and
    // fires BEFORE calling discardRecording()/the save handoff, i.e. before
    // this clear() ever runs, so the count is never read from an
    // already-wiped array.
    // Logout (wipeSessionVault → globalRecorder.discard) also routes through
    // here and deliberately bypasses the D3 dialog — a modal blocking sign-out
    // would be wrong, so the silent default is to KEEP the photos on the
    // customer record (matches 顧客ページに残す, the safe direction).
    this.photos.forEach((p) => URL.revokeObjectURL(p.objectUrl))
    this.photos = []
    this.notify()
  }
}

function randomId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const sessionPhotoStore = new SessionPhotoStore()

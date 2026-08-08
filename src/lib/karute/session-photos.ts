'use client'

import { toast } from 'sonner'

import { uploadCustomerPhoto } from '@/actions/customers'
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

  private setStatus(id: string, status: SessionPhotoStatus, serverId: string | null = null) {
    this.photos = this.photos.map((p) => (p.id === id ? { ...p, status, serverId } : p))
    this.notify()
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
    // Honest-loss disclosure (blind-round P1): a failed-upload photo exists
    // ONLY in this strip — dropping it at session end without a word is
    // silent data loss. Real keep-or-retry semantics arrive with the PR3
    // discard dialog (Liam D3); until then, say it out loud.
    // ponytail: ja-only copy — this toast fires from a non-React singleton;
    // PR3's dialog replaces it with proper i18n.
    // 'error' only: an 'uploading' photo's request is already in flight and
    // normally lands server-side after the strip clears — warning about it
    // would cry wolf. 'error' is a known non-write.
    const dropped = this.photos.filter((p) => p.status === 'error').length
    if (dropped > 0) {
      toast.warning(
        `アップロードに失敗した写真${dropped}枚は保存されていません`,
      )
    }
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

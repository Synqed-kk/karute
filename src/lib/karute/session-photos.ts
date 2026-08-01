'use client'

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

  addPhoto(file: File, category: string, customerId: string) {
    const photo: SessionPhoto = {
      id: randomId(),
      objectUrl: URL.createObjectURL(file),
      status: 'uploading',
      file,
      category,
      customerId,
    }
    this.photos = [...this.photos, photo]
    this.notify()
    void this.upload(photo)
  }

  retry(id: string) {
    const photo = this.photos.find((p) => p.id === id)
    if (!photo) return
    this.setStatus(id, 'uploading')
    void this.upload(photo)
  }

  private setStatus(id: string, status: SessionPhotoStatus) {
    this.photos = this.photos.map((p) => (p.id === id ? { ...p, status } : p))
    this.notify()
  }

  private async upload(photo: SessionPhoto) {
    try {
      const fd = new FormData()
      fd.append('file', photo.file)
      fd.append('category', photo.category)
      const result = await uploadCustomerPhoto(photo.customerId, fd)
      this.setStatus(photo.id, result && 'error' in result ? 'error' : 'done')
    } catch {
      this.setStatus(photo.id, 'error')
    }
  }

  private clear() {
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

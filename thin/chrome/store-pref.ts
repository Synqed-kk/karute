// Active-store preference — the shell's analog of the web's
// karute_active_store cookie. The DataPort sends it as the explicit
// `store-id` header on every facade call; the server clamp
// (resolveStoreForRequest) stays the authority and fails closed on a store
// the caller may not view, so a stale/forged value can never widen scope.

const KEY = 'karute-active-store'

export function getThinActiveStore(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setThinActiveStore(id: string): void {
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    /* storage unavailable — the server default (assignment/primary) applies */
  }
}

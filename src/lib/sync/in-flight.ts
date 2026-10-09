// ONE in-flight set per page: every store with a sync save or run pending,
// from the per-store form or the all-stores list. It lives in this module, not
// in a component, so it survives leaving the sync tab and coming back: a store
// claimed by a run that is still posting stays claimed until its own answer
// releases it (Greptile pass 1 on #1141, "Leaving the tab loses claims").
// '' = a form request that names no store (the route runs its default store).

type Listener = () => void

// Replaced (never mutated) on each change, so a snapshot is a stable value
// for useSyncExternalStore.
let current: ReadonlySet<string> = new Set()
const listeners = new Set<Listener>()

function set(next: ReadonlySet<string>) {
  current = next
  for (const l of listeners) l()
}

/** Marks the store in flight; false (and nothing changed) when it already is. */
export function claim(id: string): boolean {
  if (current.has(id)) return false
  set(new Set([...current, id]))
  return true
}

/** Removes only this store; a store not in the set is left alone. */
export function release(id: string): void {
  if (!current.has(id)) return
  const next = new Set(current)
  next.delete(id)
  set(next)
}

export function has(id: string): boolean {
  return current.has(id)
}

export function snapshot(): ReadonlySet<string> {
  return current
}

/** Calls the listener on every change; returns the unsubscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

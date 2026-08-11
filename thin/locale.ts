// Thin runtime locale — module-scope singleton (the thin idiom: chrome-store,
// store-pref). Every hardcoded `locale="ja"` seam in the shell reads
// getThinLocale() instead of a literal.
//
// Locale is BOOT-FROZEN: setThinLocale persists + reloads rather than
// re-rendering live. That keeps every one of those seams non-reactive — the
// smallest correct diff, since none of them re-render on a prop they never
// expected to change.
//
// ponytail: boot-frozen locale + reload; reactive locale only if a
// mid-session switcher ever ships.

const STORAGE_KEY = 'thin.locale'

export type ThinLocale = 'ja' | 'en'

function readInitial(): ThinLocale {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ja'
  } catch {
    return 'ja'
  }
}

// Read once, at module load — every later getThinLocale() call this session
// returns the same value regardless of any localStorage write that happens
// after (setThinLocale reloads the page specifically so a fresh module load
// picks up the new value).
const locale: ThinLocale = readInitial()

export function getThinLocale(): ThinLocale {
  return locale
}

export function setThinLocale(next: ThinLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* storage unavailable — reload still lands back on the frozen default */
  }
  window.location.reload()
}

// En-chunk lazy-import failure recovery (main.tsx's dynamic en.json import
// catch, 2026-08-11 packet §3 fix B): a failed en chunk load must not leave
// the boot-frozen singleton at 'en' while the caller renders ja messages in
// place — that's a session-wide mixed state (fetches/aria/nav think EN, text
// renders JA), sticky across every later boot too. Reset the persisted value
// to 'ja' and reload: one clean ja boot, loop-safe (the ja path has no
// dynamic import to fail again).
//
// Returns whether the write succeeded, WITHOUT reloading on failure — if the
// write itself throws, reloading would just re-read the still-'en' persisted
// value and hit this same failure again. The caller falls back to an
// in-place ja render instead (accepted mixed corner; storage-broken is rare
// and benign — see the packet's adjudicated no-fix list).
export function resetThinLocaleOnEnChunkFailure(): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'ja')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

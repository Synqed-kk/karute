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

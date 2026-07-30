import type { AbstractIntlMessages } from 'next-intl'

// Per-screen client-dictionary split. The [locale] layout used to serialize
// the ENTIRE messages file (~81KB minified ja) into every page's payload.
// Namespaces below ship only on the screens that read them — each such screen
// wraps itself in its own NextIntlClientProvider pick. A nested provider
// REPLACES the message set for its subtree (verified in installed use-intl:
// `messages === undefined ? prevContext?.messages : messages` — no merge), so
// every pick must be that subtree's FULL namespace closure. The closure test
// (i18n-client-messages-closure.test.ts) machine-checks all of this against
// the real import graph — edit these lists freely, the test recomputes.
export const COLD_NAMESPACES = [
  'auth',
  'coaching',
  'dataExport',
  'dataImport',
  'invite',
  'landing',
  'settings',
  'voiceEnrollment',
  'welcome',
] as const

// Sub-trees of cold namespaces that HOT surfaces read — grafted back into the
// layout provider so those screens keep working with the namespace removed:
//   settings.stores                — StoreSwitcher in the (app) shell header
//   coaching.common/panel/
//   coaching.staff.monthlyGrowth   — KaruteCoachingPanel on カルテ detail
export const RETAINED_HOT_PATHS: readonly (readonly string[])[] = [
  ['settings', 'stores'],
  ['coaching', 'common'],
  ['coaching', 'panel'],
  ['coaching', 'staff', 'monthlyGrowth'],
]

// Namespace closure each self-carrying surface serializes for its subtree.
// Values come from the import-graph walk; the closure test fails if a screen
// grows a dependency these lists don't cover.
export const PAGE_PICKS = {
  settings: [
    'auth',
    'coaching',
    'common',
    'invite',
    'karuteDetail',
    'permissions',
    'pin',
    'settings',
    'staff',
    'voiceEnrollment',
  ],
  coaching: ['coaching'],
  dataExport: ['dataExport'],
  dataImport: ['dataImport'],
  welcome: ['welcome'],
  landing: ['landing', 'localeToggle'],
  authPages: ['auth'],
  join: ['invite'],
} as const

type Tree = Record<string, unknown>

function graft(target: Tree, source: Tree, path: readonly string[]) {
  let s: unknown = source
  for (const seg of path) {
    if (!s || typeof s !== 'object') return
    s = (s as Tree)[seg]
  }
  if (s === undefined) return
  let t = target
  for (let i = 0; i < path.length - 1; i++) {
    // Clone intermediate nodes — `{ ...all }` is a shallow copy, so writing
    // into a nested object in place would mutate the module-cached messages.
    t[path[i]] = { ...((t[path[i]] ?? {}) as Tree) }
    t = t[path[i]] as Tree
  }
  t[path[path.length - 1]] = s
}

/** The [locale] layout's provider payload: everything except the cold
 *  namespaces, with the hot-surface sub-trees grafted back in. */
export function toLayoutMessages(
  all: AbstractIntlMessages,
): AbstractIntlMessages {
  const slim: Tree = { ...(all as Tree) }
  for (const ns of COLD_NAMESPACES) delete slim[ns]
  for (const p of RETAINED_HOT_PATHS) graft(slim, all as Tree, p)
  return slim as AbstractIntlMessages
}

/** A self-carrying screen's provider payload: its closure's namespaces only. */
export function pickMessages(
  all: AbstractIntlMessages,
  namespaces: readonly string[],
): AbstractIntlMessages {
  const out: Tree = {}
  for (const ns of namespaces) {
    if (ns in (all as Tree)) out[ns] = (all as Tree)[ns]
  }
  return out as AbstractIntlMessages
}

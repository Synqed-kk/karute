// ⚖ S17 fix round 5 · G2 — ONE HOME FOR EVERY LINK INTO 設定.
//
// Two rooms pointed at this room's sections with hand-written literals
// (`/business/settings?section=payments`, `/business/settings?section=booking-guard`)
// and both dropped the two things a link in this app carries: the LOCALE
// segment every other href in their own files spells, and the RESOLVED STORE.
// On 代官山 the 今日の運営 board's 保護ルール chip and レジ's 店舗設定で変更 link
// opened the SETTINGS OF ANOTHER STORE — the reader's default — which is ⚖ 8/17
// (store isolation) failing at the frame, and ④'s own Greptile lesson: a key
// screen is reached BY THE RESOLVED STORE LENS, never by whatever the
// destination decides to default to.
//
// One function so the next room that points here cannot spell it a fourth way.
// PURE, and no imports at all: it is a string built out of three values its
// caller already resolved. It is deliberately NOT in `settings.ts` — that file
// is the room's 58KB rulebook, and 今日の運営's client screen would then carry
// the whole of it to render one chip.

/** The href of a 設定 section, for a reader on a resolved store.
 *
 *  ⚠ NO `store=` WHEN THERE IS NO LENS. A caller with `null` is a reader whose
 *  view is not clamped to one store, and writing their default store into the
 *  URL would turn 「wherever I am」 into a pinned decision the reader never made
 *  — the same reason 今日の運営's own `dayHref` sets the parameter only when it
 *  has one. `section` is optional: a link to the room's front door omits it and
 *  the page opens on the first section that reader may open.
 *
 *  ⚠ AND THE ORDER IS FIXED — `section` then `store` — so the two rooms that
 *  point here produce one spelling and a pin can read it.
 *
 *  `block` (PR-3 of 予約の色分け) lands ON one block of that section: the room
 *  renders every block as `st-blk-<block id>` (SettingsScreen's `Block`),
 *  the same anchor its jump list scrolls to, cleared now by the page
 *  scroller's `scroll-padding-top` (settings.css's `html:has(.biz .page.pg-settings)`
 *  rule), not a per-block margin. A fragment, so the page reader is unchanged. */
export function settingsHref(locale: string, store: string | null, section?: string, block?: string): string {
  const q = new URLSearchParams()
  if (section) q.set('section', section)
  if (store) q.set('store', store)
  const query = q.toString()
  return `/${locale}/business/settings${query ? `?${query}` : ''}${block ? `#st-blk-${block}` : ''}`
}

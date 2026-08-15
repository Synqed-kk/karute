/**
 * iOS date/time input box-model contract.
 *
 * iOS/WKWebView paints `input[type="date"]` (and its time-family siblings)
 * through the native control theme, which forces `box-sizing: content-box`
 * on the control AFTER the cascade — it overrides Tailwind preflight's
 * `*{box-sizing:border-box}` and even an explicit author declaration. With
 * the shared Input's `w-full` + `px-2.5` + 1px border that makes the border
 * box exactly 22px wider than its grid column, and the field slides under
 * its neighbour (新規カルテの作成's セッション日 under 所要時間, build 1.1(16),
 * sim-measured on 440pt and 390pt). The same theme pass injects a min-width
 * (102px date / 168px datetime-local) that overrides `min-w-0`.
 *
 * The single base rule in globals.css that opts these controls out of the
 * native theme is the whole fix, and it is invisible everywhere it could be
 * checked: no desktop engine reproduces the overflow (Blink and macOS
 * WebKit both compute border-box), so neither the responsive sweep nor a
 * render test can catch a regression here. Source-pin is the only guard
 * that can — one rule, at the shared layer, covering the whole
 * date/time family so a new `type="month"` field can never ship naked.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

/** Comment bodies would satisfy every check below — strip them first. */
const rawCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Normalize attribute-selector spelling: `[type='X']` and `[type=X]` both
 *  select the same element as `[type="X"]` — fold them to one spelling so
 *  every check below (rule-find, per-type coverage, re-theme detection) sees
 *  all three identically. Match double/single/bare explicitly (in that
 *  order) so an already-double-quoted value isn't re-captured as bare and
 *  double-wrapped; unquoted values can't contain `]`, whitespace, or a
 *  quote char, so `[^\]\s'"]+` is safe. */
const css = rawCss.replace(
  /\[type=(?:"([^"]*)"|'([^']*)'|([^\]\s'"]+))\]/g,
  (_, dbl, single, bare) => `[type="${dbl ?? single ?? bare}"]`
)

/** Innermost `selector { declarations }` pairs. `[^{}]` can't cross a brace,
 *  so at-rule wrappers (@layer/@media) fall out of the selector capture. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
  sel: sel.trim(),
  body: body.trim(),
}))

/** Every input type WebKit themes as a native date/time control. */
const DATE_TYPES = ['date', 'datetime-local', 'month', 'time', 'week']

describe('date/time inputs opt out of the iOS native control theme', () => {
  const rule = rules.find(
    (r) => /input\[type="date"\]/.test(r.sel) && /(^|[\s;])appearance:\s*none/.test(r.body)
  )

  it('has a shared rule that drops the native appearance', () => {
    expect(rule).toBeDefined()
    // Both spellings: WebKit only honours the prefixed property on these
    // controls, the standard one is what every other engine reads.
    expect(rule?.body).toMatch(/-webkit-appearance:\s*none/)
    expect(rule?.body).toMatch(/(^|[\s;])appearance:\s*none/)
  })

  it.each(DATE_TYPES)('covers input[type="%s"]', (type) => {
    expect(rule?.sel).toContain(`input[type="${type}"]`)
  })

  it('is never re-themed by a later rule', () => {
    const reThemed = rules.filter(
      (r) =>
        DATE_TYPES.some((t) => r.sel.includes(`input[type="${t}"]`)) &&
        [...r.body.matchAll(/appearance:\s*([\w-]+)/g)].some((m) => m[1] !== 'none')
    )
    expect(reThemed.map((r) => r.sel)).toEqual([])
  })

  /* The guard rule lives in the `base` cascade layer; Tailwind utilities
   * live in the `utilities` layer, which wins over base REGARDLESS of
   * selector specificity (see the sibling pointer:coarse block at
   * src/app/globals.css:236-238, which documents exactly this and is why
   * IT needs !important). So the real bypass vectors for a later re-theme
   * are: (a) another globals.css rule in the SAME layer with different
   * selector quoting — closed by the normalization above; (b) `!important`
   * in globals.css, which ignores layer order too — closed by this test;
   * (c) a utilities-layer class (e.g. `appearance-auto`) or an inline style
   * on a date input in component code — OUTSIDE this test's reach (it scans
   * globals.css only); a repo grep shows zero such usages today. We
   * deliberately do NOT add !important to the guard rule itself: nothing in
   * `base` fights it, and !important would be the over-fix.
   *
   * (Secondary note: within a single layer, specificity still governs — the
   * shared rule's selector is (0,1,1) vs. a bare `input` at (0,0,1) or a
   * class at (0,1,0), both lower. That fact is why spelling variants are
   * the only same-layer bypass; it just isn't why utilities can't win.) */
  it('no input rule re-themes with !important', () => {
    const importantOverrides = rules.filter(
      (r) =>
        /input/i.test(r.sel) &&
        [...r.body.matchAll(/appearance:\s*([\w-]+)\s*!important/gi)].some(
          (m) => m[1] !== 'none'
        )
    )
    expect(importantOverrides.map((r) => r.sel)).toEqual([])
  })
})

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

  /* Spelling normalization above plus this check close the bypass: the
   * shared rule's selector is an attribute selector on `input`, specificity
   * (0,1,1) — a bare `input` selector is (0,0,1) and a class selector is
   * (0,1,0), both LOWER than (0,1,1), so no plain later rule can win the
   * cascade regardless of source order. The only ways a later globals.css
   * rule could still re-theme the control are (a) writing the same
   * attribute selector with different quoting — closed by normalizing
   * `[type=X]`/`[type='X']` to `[type="X"]` before every check above — or
   * (b) `!important`, which ignores specificity entirely. This is the
   * `!important` half. */
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

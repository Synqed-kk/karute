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
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
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
})

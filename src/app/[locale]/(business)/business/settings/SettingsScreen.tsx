'use client'

// 設定 — the room every other room's dial was promised to.
//
// ⚖ ONE PAGE, ONE SECTION AT A TIME. canon's settings family is nineteen pages
// behind a category rail; this is that rail with the panel beside it, so a reader
// never scrolls past a setting they did not come for. The rail carries canon's
// own five groups and canon's own labels, because canon's IA is the product's IA
// and a rail that changes shape between releases is a rail nobody learns.
//
// ⚖ EVERYTHING MOVES (Liam 2026-09-01). Every control on this page is LIVE: it
// changes when it is pressed, the section it belongs to goes dirty, 保存 commits
// it, and a preview sentence beside it is rewritten from the new value. The
// honesty is ONE footnote per store section — 「保存はこの画面の中だけに反映され
// ます」 — plus the page's own サンプルデータ dateline, instead of a refusal
// paragraph under every row.
//
// WHAT IS CLIENT STATE HERE: every control's value, what was last saved, which
// section is open, whether the phone is showing the list or the section, the
// result line of a block's action, and which step of the 画面の説明 tour the
// reader is on. 自分の表示設定 is the one section whose values ALSO persist —
// to this browser's own storage, for this reader, because a personal preference
// is nobody else's permission.
//
// CLASS NAMES ARE PREFIXED `st-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and the
// neighbours state BARE `.biz .<name>` rules on the exact names a settings page
// would want (`.panel`, `.card`, `.row`, `.chip`, `.seg`, `.switch`…). A fence
// that enumerates shared names rots as the neighbours grow; not colliding at all
// cannot. `page` / `h1` / `btn` are the SHELL's and restated here, so those three
// are fenced in settings.css at four levels.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  blockingError,
  commitNumber,
  controlIdsOf,
  fillTemplate,
  keepCardOffHeading,
  labelOfValue,
  PREFS_DEFAULT,
  readPrefs,
  sectionDirty,
  type ControlKind,
  type RowControl,
  type RowValue,
  type SettingsBlock,
  type SettingsProps,
  type SettingsRow,
  type SettingsSection,
} from '@/business/lib/settings'

/** THE ROUTE WRAPPER. Every rule in settings.css is scoped under this class, and
 *  `.page.pg-settings` (four levels) rather than `.pg-settings` (three) so a
 *  sibling's own three-level rule (`.biz .page .btn`, customers.css) cannot win
 *  the room back on insertion order. */
const ROOT = 'page pg-settings'

/** ⚖ R6-20, CARRIED (room 6's `Overlay`, room 8's tour). A dismiss-by-backdrop
 *  surface that mounts under a pointer already resting where its opener was will
 *  eat the SECOND press of a double-click and close itself instantly — and
 *  neither 「the press began on the backdrop」 nor 「the browser called it a
 *  double-click」 can separate that press from a decision, because both are true
 *  of it. 500ms is the platform's own double-click interval (macOS and Windows
 *  defaults), so the window in which a second press still belongs to the first
 *  gesture is covered by construction rather than by a number chosen to fit a
 *  test. The tour is this room's only such surface. */
const SETTLE_MS = 500

/** 自分の表示設定's home. Versioned in the name so a later shape change cannot
 *  read an older one's value. */
const PREF_KEY = 'synqedBizDisplayPrefs.v1'
const DENSITY_ID = 'my-display.density'
const EMPHASIS_ID = 'my-display.emphasis'

const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total
const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** The seed every control starts from, taken once from the payload. */
function seedOf(props: SettingsProps): Record<string, RowValue> {
  const out: Record<string, RowValue> = {}
  for (const section of props.sections) {
    for (const b of section.blocks) for (const r of b.rows) for (const c of r.controls) out[c.id] = c.value
  }
  return out
}

function kindsOf(props: SettingsProps): Record<string, ControlKind> {
  const out: Record<string, ControlKind> = {}
  for (const section of props.sections) {
    for (const b of section.blocks) for (const r of b.rows) for (const c of r.controls) out[c.id] = c.control
  }
  return out
}

export function SettingsScreen(props: SettingsProps) {
  // ⚠ `null` IS THE PHONE'S LIST STATE, not「nothing chosen」. On a desk the
  // panel always shows something (the opening section); on a phone the rail IS
  // the page until a reader picks a row, which is ⚖ list-is-the-page.
  const [picked, setPicked] = useState<string | null>(null)
  // ⚠ THE SEED IS TAKEN ONCE. `page.tsx` keys this screen by the resolved store,
  // so a lens switch remounts it and re-seeds from the new store's payload —
  // which is the ⚖ 8/17 isolation law at the frame as well as at the read.
  const [values, setValues] = useState<Record<string, RowValue>>(() => seedOf(props))
  const [saved, setSaved] = useState<Record<string, RowValue>>(() => seedOf(props))
  const [savedNote, setSavedNote] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, string>>({})
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const kinds = useMemo(() => kindsOf(props), [props])

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const tourRectsRef = useRef<SpotRect[]>([])
  /** ⚠ STARTS AT INFINITY so the dim layer FAILS CLOSED: it refuses every press
   *  until the tour has actually been laid out. */
  const settledAt = useRef(Number.POSITIVE_INFINITY)

  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  // 自分の表示設定 — read once after mount. A refusal (private mode, storage
  // disabled) is not a reason to break the page: the seeded defaults stand.
  useEffect(() => {
    let stored = PREFS_DEFAULT
    try {
      stored = readPrefs(window.localStorage.getItem(PREF_KEY))
    } catch {
      stored = PREFS_DEFAULT
    }
    setValues((v) => ({ ...v, [DENSITY_ID]: stored.density, [EMPHASIS_ID]: stored.emphasis }))
    setSaved((v) => ({ ...v, [DENSITY_ID]: stored.density, [EMPHASIS_ID]: stored.emphasis }))
  }, [])

  /** ⚠ THE ONE SECTION THAT SAVES OUTSIDE THIS SCREEN WRITES ON THE PRESS, not
   *  on a 保存 button: canon's own 自分の表示設定 has no save step either, and a
   *  personal preference that needed committing would be the page asking
   *  permission for something nobody else can see. */
  const setValue = useCallback((id: string, next: RowValue) => {
    setValues((prev) => {
      const merged = { ...prev, [id]: next }
      if (id === DENSITY_ID || id === EMPHASIS_ID) {
        try {
          window.localStorage.setItem(
            PREF_KEY,
            JSON.stringify({ density: merged[DENSITY_ID], emphasis: merged[EMPHASIS_ID] }),
          )
        } catch {
          // see above — the choice still applies to this render.
        }
        setSaved((s) => ({ ...s, [id]: next }))
      }
      return merged
    })
  }, [])

  const shownId = picked ?? props.openingSectionId
  const section = props.sections.find((s) => s.id === shownId) ?? null
  const isDetail = picked !== null

  const labelFor = useCallback(
    (id: string): string | null => {
      const kind = kinds[id]
      if (!kind) return null
      return labelOfValue(kind, values[id])
    },
    [kinds, values],
  )

  const commitSection = useCallback((target: SettingsSection) => {
    const ids = controlIdsOf(target)
    setSaved((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = values[id]
      return next
    })
    setSavedNote((prev) => ({ ...prev, [target.id]: '保存しました（この画面の中だけ）' }))
  }, [values])

  // ⚖ Liam 8/23 — 画面の説明. A section joins the walk by DECLARING
  // `data-guide-title` + `data-guide` ON ITSELF, so there is no list to keep in
  // sync: what renders is what is explained, and what the band or the open
  // section hides drops out of the walk and out of the N/M count by itself.
  //
  // ⚠ THE WALK IS DECLARED ON ROWS AND BLOCK HEADS, NOT ON THE WHOLE PANEL, and
  // that is a placement decision as much as a teaching one: a target taller than
  // the viewport leaves the engine's card nowhere to go but on top of the thing
  // it is explaining (the room-5 F5 defect). Rows are short, so every step has a
  // free side — and 「what does THIS control do」 is the question a settings page
  // is actually asked.
  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    // ⚠ AND THE ENGINE'S LAST RESORT IS CORRECTED (see `keepCardOffHeading`).
    // On a desk every row has a free side and this is a pass-through; at 390 a
    // stacked row is full width and taller than half the viewport, so the engine
    // had nowhere to put the card but on top of the row — measured, and then
    // fixed, rather than argued away.
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  useLayoutEffect(() => {
    settledAt.current = tourOpen ? Date.now() : Number.POSITIVE_INFINITY
  }, [tourOpen])

  useEffect(() => {
    if (!tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourIdx(-1)
      if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
      if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tourOpen])

  // The hole is drawn in viewport coordinates, so anything that moves the page
  // under it — a scroll, a resize, a band arriving — has to re-measure.
  useEffect(() => {
    if (!tourOpen) return
    const bump = () => setTourTick((t) => t + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [tourOpen])

  // ⚖ THE KEYBOARD MUST NOT BE STRANDED BY THE TOUR. Opening it puts focus on
  // 次へ; closing it puts focus back on the ? it came from.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) { wasOpen.current = true; tourNextRef.current?.focus(); return }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  const groups: string[] = []
  for (const row of props.rail) if (!groups.includes(row.group)) groups.push(row.group)

  const dirty = section !== null && section.gate === 'open' ? sectionDirty(section, values, saved) : false
  const blocked = section !== null && section.gate === 'open' ? blockingError(section, values) : null

  return (
    <div className={`${ROOT}${isDetail ? ' is-detail' : ''}`} ref={rootRef}>
      <header
        className="st-head"
        data-guide-title="設定"
        data-guide="お店の決まりごとと、自分の見え方を変える画面です。左の一覧から見たい設定を選ぶと、右にその中身が出ます。"
      >
        <div className="st-eyebrow">{props.dateline}</div>
        <div className="st-titleline">
          <h1>設定</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              has. A hairline circle, never a filled one (⚖ R13). */}
          <button
            className="st-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="stTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="st-sub">{props.subtitle}</p>
      </header>

      <div className="st-body">
        <aside
          className="st-rail"
          aria-label={props.railHeading}
          data-guide-title="設定カテゴリー"
          data-guide="設定の一覧です。「権限がありません」はいまのアカウントでは開けないところです。行を押すと、右にその設定が出ます。"
        >
          <div className="st-rail-head">{props.railHeading}</div>
          {groups.map((group) => (
            <div className="st-rail-group" key={group}>
              <div className="st-rail-label">{group}</div>
              {props.rail
                .filter((row) => row.group === group)
                .map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`st-rail-item${row.id === shownId ? ' is-on' : ''}`}
                    aria-current={row.id === shownId ? 'page' : undefined}
                    onClick={() => setPicked(row.id)}
                  >
                    <span className="st-rail-name">{row.label}</span>
                    {row.state === 'no-rights' && <span className="st-flag is-rights">権限がありません</span>}
                    {row.scope === 'self' && <span className="st-flag is-self">自分だけ</span>}
                  </button>
                ))}
            </div>
          ))}
        </aside>

        <div className="st-panel">
          {/* ⚖ list-is-the-page: at ≤743 the rail is the page and a section is its
              own screen, so the way back has to be ON that screen. It is rendered
              always and hidden by the band, never conditionally mounted — a
              button that appears and disappears with a resize is a target that
              moves under a thumb. */}
          <button className="st-back" type="button" onClick={() => setPicked(null)}>
            ← {props.railHeading}
          </button>

          {/* ⚠ THIS BRANCH IS UNREACHABLE BY CONSTRUCTION TODAY, AND IT IS KEPT
              DELIBERATELY. 自分の表示設定 is `scope: 'self'`, so `gateOf`
              answers `open` for every role — including one this world has never
              heard of — and `firstOpenSection` therefore never returns null. It
              stays as DEFENCE for a rail whose every row could one day be gated:
              this room's rule is that a panel is never a blank rectangle, and
              that rule needs somewhere to land. The suite pins the CLAIM (every
              role opens on something) rather than the presence of this string. */}
          {section === null ? (
            <section className="st-boundary" data-guide-title="表示できる設定がありません" data-guide="いまのアカウントの権限では、開ける設定がありません。">
              <p>{props.boundaryFallback}</p>
            </section>
          ) : (
            <>
              <div
                className="st-sec-head"
                data-guide-title={section.title}
                data-guide={section.lead || `${section.title}の画面です。`}
              >
                <span className="st-kicker">{section.kicker}</span>
                <h2>{section.title}</h2>
                {section.lead && <p className="st-lead">{section.lead}</p>}
              </div>

              {section.gate === 'no-rights' ? (
                <section
                  className="st-boundary"
                  data-guide-title="権限について"
                  data-guide="この設定は、権限のあるアカウントでのみ表示されます。ここでは中身を出していません。"
                >
                  <p>{section.boundaryLine}</p>
                </section>
              ) : (
                <>
                  <div className="st-cols">
                    <div className="st-main">
                      {section.blocks.map((b) => (
                        <Block
                          key={b.id}
                          block={b}
                          values={values}
                          onChange={setValue}
                          labelFor={labelFor}
                          result={results[b.id] ?? null}
                          error={actionErrors[b.id] ?? null}
                          onAction={() => runAction(b, values, setResults, setActionErrors, labelFor)}
                          onLink={setPicked}
                        />
                      ))}
                    </div>

                    {section.aside && (
                      <aside
                        className="st-aside"
                        data-guide-title={section.aside.title}
                        data-guide="この画面が出している値の出どころです。ほかの画面と同じ値を見ていることが、ここで確かめられます。"
                      >
                        <h3>{section.aside.title}</h3>
                        <dl className="st-trace">
                          {section.aside.lines.map((line) => (
                            <div className="st-trace-row" key={line.label}>
                              <dt>{line.label}</dt>
                              <dd>{line.value}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="st-aside-note">{section.aside.note}</p>
                      </aside>
                    )}
                  </div>

                  {/* ⚠ 自分の表示設定 HAS NO SAVE BUTTON, AND THAT IS THE POINT:
                      it is already saved, in this browser, the moment it is
                      pressed. Printing 保存する under it would ask a reader to
                      commit something nobody else can see. */}
                  {section.persist === 'local' ? (
                    <p className="st-foot">{props.selfSaveLine}</p>
                  ) : (
                    <div className="st-savebar">
                      <span className="st-save-note" role="status">
                        {blocked ?? (dirty ? '未保存の変更があります' : savedNote[section.id] ?? '変更はありません')}
                      </span>
                      <button
                        type="button"
                        className="st-save"
                        disabled={!dirty || blocked !== null}
                        onClick={() => commitSection(section)}
                      >
                        保存する
                      </button>
                    </div>
                  )}
                  {section.persist !== 'local' && <p className="st-foot">{props.demoSaveLine}</p>}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {tourOpen && (
        <>
          <div
            className="st-spot-catch"
            onClick={(e) => {
              // ⚖ R6-20 — a press inside the settle window belongs to the gesture
              // that OPENED the tour, not to a decision to close it.
              if (Date.now() - settledAt.current < SETTLE_MS) return
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              if (hit >= 0) setTourIdx(hit)
              else setTourIdx(-1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="st-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="st-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="st-spot-card"
            id="stTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="st-spot-text">{tourStep?.text ?? ''}</span>
            <div className="st-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="st-spot-foot">
              <button type="button" className="st-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="st-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="st-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="st-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── a block ────────────────────────────────────────────────────────────────

function Block({
  block,
  values,
  onChange,
  labelFor,
  result,
  error,
  onAction,
  onLink,
}: {
  block: SettingsBlock
  values: Record<string, RowValue>
  onChange: (id: string, v: RowValue) => void
  labelFor: (id: string) => string | null
  result: string | null
  error: string | null
  onAction: () => void
  onLink: (sectionId: string) => void
}) {
  const rows = block.table === null ? block.table : filterTable(block, values)
  return (
    <section
      className="st-block"
      data-guide-title={block.title}
      data-guide={block.note || `${block.title}の設定です。`}
    >
      <div className="st-block-head">
        <h3>{block.title}</h3>
        {block.flag && <span className="st-flag is-soon">{block.flag}</span>}
      </div>
      {block.note && <p className="st-block-note">{block.note}</p>}
      {block.rightsNote && <p className="st-rights">{block.rightsNote}</p>}

      {block.rows.map((r) => (
        <Row key={r.id} row={r} values={values} onChange={onChange} />
      ))}

      {block.list && (
        <div className="st-list">
          <b>{block.list.title}</b>
          <ul>
            {block.list.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {rows && (
        <div
          className="st-table"
          role="table"
          aria-label={block.title}
          // The column count is the TABLE's own fact, so the sheet never has to
          // guess it: a four-column record and a two-column one share one rule.
          style={{ ['--st-cols' as string]: String(block.table!.head.length) } as CSSProperties}
        >
          <div className="st-tr is-head" role="row">
            {block.table!.head.map((h) => (
              <span className="st-th" role="columnheader" key={h}>{h}</span>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="st-empty">この条件に一致する記録はありません。期間や種類を変えてお試しください。</p>
          ) : (
            rows.map((tr) => (
              <div className="st-tr" role="row" key={tr.cells.join('|')}>
                {tr.cells.map((cell, i) => (
                  <span className="st-td" role="cell" key={`${i}-${cell}`}>{cell}</span>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* ⚠ THE PREVIEW IS THE DEAD-LEVER LAW, GENERALISED. It is written from
          the LIVE values, so pressing any control in this block really rewrites
          a sentence the reader is looking at. */}
      {block.preview && (
        <div
          className="st-preview"
          aria-live="polite"
          {...Object.fromEntries(
            Object.entries(block.preview.attrs ?? {}).map(([attr, id]) => [attr, String(values[id] ?? '')]),
          )}
        >
          <div className="st-pv-note">いまの設定での見え方</div>
          <p className="st-pv-text">{fillTemplate(block.preview.template, labelFor)}</p>
          {block.preview.attrs && (
            <div className="st-pv-board">
              <div className="st-pv-row"><span>10:00 見本 あかり 様</span><span>テスト整体 60分</span></div>
              <div className="st-pv-row"><span>11:30 見本 かえで 様</span><span>テスト骨盤ケア 90分</span></div>
              <div className="st-pv-row"><span>13:00 見本 さくら 様</span><span>テストストレッチ 30分</span></div>
            </div>
          )}
        </div>
      )}

      {block.facts.map((f) => (
        <p className="st-fact" key={f}>{f}</p>
      ))}

      {block.links.length > 0 && (
        <div className="st-links">
          {block.links.map((l) => (
            <button type="button" className="st-link" key={l.sectionId + l.label} onClick={() => onLink(l.sectionId)}>
              {l.label} →
            </button>
          ))}
        </div>
      )}

      {block.action && (
        <div className="st-action">
          <button type="button" className="st-act" onClick={onAction}>{block.action.label}</button>
          {error && <span className="st-act-error">{error}</span>}
          {!error && result && <span className="st-act-result" role="status">{result}</span>}
        </div>
      )}

      {block.audit && <p className="st-audit">{block.audit}</p>}
    </section>
  )
}

/** The one filtered table in the room (監査ログ). A filter whose value is `all`
 *  matches every row, which is how canon's own 全て option behaves. */
function filterTable(block: SettingsBlock, values: Record<string, RowValue>) {
  const table = block.table!
  if (block.filterBy.length === 0) return table.rows
  return table.rows.filter((r) =>
    block.filterBy.every((id) => {
      const v = values[id]
      if (typeof v !== 'string' || v === 'all') return true
      return r.tags.includes(v)
    }),
  )
}

function runAction(
  block: SettingsBlock,
  values: Record<string, RowValue>,
  setResults: (fn: (prev: Record<string, string>) => Record<string, string>) => void,
  setErrors: (fn: (prev: Record<string, string>) => Record<string, string>) => void,
  labelFor: (id: string) => string | null,
) {
  const action = block.action
  if (!action) return
  // ⚠ AN EMPTY REQUIRED INPUT GETS AN EXPLICIT MESSAGE, NEVER A SILENT NO-OP
  // (canon's own raw-string / explicit-empty law on the 書き出し page).
  if (action.requires) {
    const v = values[action.requires]
    const empty = Array.isArray(v) ? v.length === 0 : typeof v === 'string' ? v.trim() === '' : !v
    if (empty) {
      setErrors((prev) => ({ ...prev, [block.id]: action.requireError ?? '入力してください。' }))
      return
    }
  }
  setErrors((prev) => ({ ...prev, [block.id]: '' }))
  setResults((prev) => ({ ...prev, [block.id]: fillTemplate(action.template, labelFor) }))
}

// ── a row ──────────────────────────────────────────────────────────────────

function Row({
  row,
  values,
  onChange,
}: {
  row: SettingsRow
  values: Record<string, RowValue>
  onChange: (id: string, v: RowValue) => void
}) {
  return (
    <section
      className="st-dial"
      data-guide-title={row.label}
      data-guide={`${row.description || row.label + 'の設定です。'} ${row.trio?.guardrail ?? ''}`.trim()}
    >
      <div className="st-dial-what">
        <b>{row.label}</b>
        {row.scopeLabel && <span className="st-scope">{row.scopeLabel}</span>}
        {row.meta.map((m) => (
          <span className="st-meta" key={m}>{m}</span>
        ))}
      </div>
      <div className="st-dial-ctl">
        {row.controls.map((c) => (
          <Control key={c.id} row={row} c={c} value={values[c.id]} onChange={onChange} />
        ))}
      </div>
      {/* ⚠ A SIBLING OF THE LABEL, NOT A CHILD OF IT. At the LEVEL band the label
          sits in a 140px column and the description would be a column of
          syllables inside it; as its own grid child it spans both columns. */}
      {row.description && <p className="st-dial-desc">{row.description}</p>}
      {/* ⚖ 8/21 — the default and the guardrail always show on a policy row. A
          dial whose guardrail is invisible is a dial a manager can hurt their own
          shop with. The 業種 line prints ONLY where a ruling gave one: absence is
          silence, never a sentence saying there is nothing. */}
      {row.trio && (
        <ul className="st-trio">
          <li className="st-trio-base">{row.trio.base}</li>
          <li className="st-trio-rail">{row.trio.guardrail}</li>
          {row.trio.businessType && <li className="st-trio-type">{row.trio.businessType}</li>}
        </ul>
      )}
      {row.controls.filter((c) => c.locked).map((c) => (
        <p className="st-why" key={`${c.id}-why`}>{c.locked}</p>
      ))}
    </section>
  )
}

// ── a control ──────────────────────────────────────────────────────────────

function Control({
  row,
  c,
  value,
  onChange,
}: {
  row: SettingsRow
  c: RowControl
  value: RowValue
  onChange: (id: string, v: RowValue) => void
}) {
  const k = c.control
  const locked = c.locked !== undefined
  /** A locked control stays FOCUSABLE (`aria-disabled`, never `disabled`) so its
   *  reason is reachable by keyboard and screen reader; the reason rides the
   *  accessible name as well, because a screen reader drops `title` once a
   *  description is present. */
  const inert = locked
    ? { 'aria-disabled': 'true' as const, title: c.locked, 'aria-label': `${c.aria} — ${c.locked}` }
    : {}
  /** ⚠ A CONTROLLED FIELD ALWAYS GETS AN `onChange`, EVEN WHEN IT IS LOCKED.
   *  React treats `value` without one as a read-only field and warns on every
   *  render — the probe's console sweep caught exactly that. `readOnly` would
   *  silence it too, but a no-op handler keeps the shape of every other control
   *  and leaves `aria-disabled` (never `disabled`) to carry the meaning, so the
   *  reason stays reachable by keyboard. */
  const noop = () => {}

  if (k.kind === 'segment') {
    return (
      <div className="st-seg" role="group" aria-label={c.aria}>
        {k.options.map((opt) => {
          const on = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              className={`st-opt${on ? ' is-on' : ''}`}
              aria-pressed={on}
              {...inert}
              onClick={locked ? undefined : () => onChange(c.id, opt.value)}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (k.kind === 'chips') {
    const picked = Array.isArray(value) ? value : []
    return (
      <div className="st-seg is-chips" role="group" aria-label={c.aria}>
        {k.options.map((opt) => {
          const on = picked.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              className={`st-opt${on ? ' is-on' : ''}`}
              aria-pressed={on}
              {...inert}
              onClick={locked ? undefined : () => onChange(c.id, on ? picked.filter((v) => v !== opt.value) : [...picked, opt.value])}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (k.kind === 'swatch') {
    return (
      <div className="st-swatches" role="group" aria-label={c.aria}>
        {k.options.map((opt) => {
          const on = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              className={`st-swatch${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={opt.label}
              title={opt.label}
              style={{ background: opt.hex ?? opt.value }}
              {...inert}
              onClick={locked ? undefined : () => onChange(c.id, opt.value)}
            />
          )
        })}
      </div>
    )
  }

  if (k.kind === 'switch') {
    const on = value === true
    return (
      <div className="st-switchline">
        <span className={`st-state${on ? ' is-on' : ''}`}>{on ? k.onLabel : k.offLabel}</span>
        <button
          type="button"
          className="st-switch"
          role="switch"
          aria-checked={on}
          aria-label={c.aria}
          {...inert}
          onClick={locked ? undefined : () => onChange(c.id, !on)}
        />
      </div>
    )
  }

  if (k.kind === 'select') {
    return (
      <select
        className="st-select"
        aria-label={c.aria}
        value={String(value ?? '')}
        {...inert}
        onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
      >
        {k.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }

  if (k.kind === 'number') {
    return (
      <span className="st-numline">
        <input
          className="st-input is-num"
          type="number"
          inputMode="numeric"
          min={k.min}
          max={k.max}
          step={k.step}
          aria-label={c.aria}
          value={String(value ?? '')}
          {...inert}
          onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
          // ⚠ THE CLAMP FIRES ON COMMIT, NOT PER KEYSTROKE. A clamp that ran on
          // every character makes 「1」 unreachable on the way to 「14」 — the
          // guardrail would be fighting the reader instead of protecting them.
          onBlur={locked ? undefined : (e) => onChange(c.id, String(commitNumber(e.target.value, k.min, k.max)))}
        />
        {k.unit && <span className="st-unit">{k.unit}</span>}
      </span>
    )
  }

  if (k.kind === 'time') {
    return (
      <input
        className="st-input is-time"
        type="time"
        aria-label={c.aria}
        value={String(value ?? '')}
        {...inert}
        onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
      />
    )
  }

  if (k.kind === 'text') {
    const empty = k.required && String(value ?? '').trim() === ''
    return (
      <span className="st-textline">
        <input
          className={`st-input${empty ? ' is-empty' : ''}`}
          type="text"
          aria-label={c.aria}
          placeholder={k.placeholder}
          maxLength={k.maxLength}
          value={String(value ?? '')}
          {...inert}
          onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
        />
        {empty && <span className="st-field-msg">{row.label}を入力してください（空欄では保存できません）</span>}
      </span>
    )
  }

  return (
    <div className={`st-readout${k.numeric ? '' : ' is-phrase'}`}>
      <b>{String(value ?? '')}</b>
      {k.unit && <span>{k.unit}</span>}
    </div>
  )
}

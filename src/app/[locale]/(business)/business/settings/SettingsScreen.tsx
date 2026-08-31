'use client'

// 設定 — the room every other room's dial was promised to.
//
// ⚖ ONE PAGE, ONE SECTION AT A TIME. canon's settings family is eighteen pages
// behind a category rail; this is that rail with the panel beside it, so a reader
// never scrolls past a dial they did not come for. The rail carries canon's own
// five groups and canon's own labels, because canon's IA is the product's IA and
// a rail that changes shape between releases is a rail nobody learns.
//
// ⚖ NOTHING STORE-WIDE ON THIS PAGE SAVES, AND EVERY ROW SAYS SO IN ITS OWN
// WORDS. A store dial is a decision about a business's own money, people and
// privacy; a control that only produced a toast would be worse than no control,
// so each one shows the value the product is REALLY using and refuses the change
// with the registry line it reconnects through.
//
// ⚠ …WITH EXACTLY ONE EXCEPTION, AND IT IS THE POINT OF THE ROOM. 自分の表示設定
// is self-scoped — 「個人スコープ、権限ゲートなし」 in canon's own comment — so it
// is a LIVE control that really saves, in this browser, for this reader. It is
// not gated by the settings permission and it does not go through the refusal
// table, because nobody's permission is involved in how somebody likes their own
// board to look.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which section is open, whether the
// phone is showing the list or the section, the reader's two display preferences,
// and which step of the 画面の説明 tour they are on. All of it is browsing.
//
// CLASS NAMES ARE PREFIXED `st-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and the
// neighbours state BARE `.biz .<name>` rules on the exact names a settings page
// would want (`.panel`, `.card`, `.row`, `.chip`, `.seg`, `.switch`…). A fence
// that enumerates shared names rots as the neighbours grow; not colliding at all
// cannot. `page` / `h1` / `btn` are the SHELL's and restated here, so those three
// are fenced in settings.css at four levels.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  DENSITY_OPTIONS,
  EMPHASIS_OPTIONS,
  keepCardOffHeading,
  PREFS_DEFAULT,
  readPrefs,
  type Density,
  type Emphasis,
  type Prefs,
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
 *  read an older one's value (the same reason the rail's own key is spelled). */
const PREF_KEY = 'synqedBizDisplayPrefs.v1'

export type ControlKind =
  | { kind: 'segment'; options: Array<{ value: string; label: string }>; current: string }
  | { kind: 'switch'; on: boolean; onLabel: string; offLabel: string }
  /** ⚠ `numeric` IS A LAYOUT FACT, NOT A TYPE HINT. A readout carries either a
   *  MEASURE (¥0, 61日, 12か月, 20回) — which wants the big tabular figure a
   *  reader scans for — or a phrase (a role list, 「設定ページ全体でひとつ」),
   *  which at that size becomes a headline shouting over the section title. The
   *  shots caught the second case; the flag is the smallest honest fix. */
  | { kind: 'readout'; text: string; unit: string; numeric: boolean }

export interface DialRow {
  id: string
  label: string
  description: string
  /** 事業全体 / この店舗 — printed on every row, never inferred by the reader. */
  scopeLabel: string
  control: ControlKind
  /** ⚖ 8/21's three parts, and all three are always shown. */
  trio: { base: string; guardrail: string; businessType: string }
  refusal: string
}

export interface SettingsSection {
  id: string
  group: string
  label: string
  scope: 'store' | 'self'
  gate: 'open' | 'no-rights'
  boundaryLine: string | null
  kicker: string
  title: string
  lead: string
  dials: DialRow[]
  aside: { title: string; lines: Array<{ label: string; value: string }>; note: string } | null
  soon: { title: string; body: string; willCarry: string[] } | null
  prefs: boolean
}

export interface RailRow {
  id: string
  group: string
  label: string
  state: 'live' | 'soon' | 'no-rights'
  scope: 'store' | 'self'
}

export interface SettingsProps {
  dateline: string
  lensLabel: string
  subtitle: string
  rail: RailRow[]
  railHeading: string
  sections: SettingsSection[]
  openingSectionId: string | null
  noSaveLine: string
  boundaryFallback: string
  roleLabel: string
}

const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total
const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

const DENSITY_LABEL: Record<Density, string> = { spacious: 'ゆったり', standard: '標準', compact: 'コンパクト' }
const EMPHASIS_LABEL: Record<Emphasis, string> = { subtle: '控えめ', standard: '標準', strong: '強め' }

export function SettingsScreen(props: SettingsProps) {
  // ⚠ `null` IS THE PHONE'S LIST STATE, not「nothing chosen」. On a desk the
  // panel always shows something (the opening section); on a phone the rail IS
  // the page until a reader picks a row, which is ⚖ list-is-the-page.
  const [picked, setPicked] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Prefs>(PREFS_DEFAULT)
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

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
  // disabled) is not a reason to break the page: the defaults stand.
  useEffect(() => {
    try {
      setPrefs(readPrefs(window.localStorage.getItem(PREF_KEY)))
    } catch {
      setPrefs(PREFS_DEFAULT)
    }
  }, [])

  const savePrefs = useCallback((next: Prefs) => {
    setPrefs(next)
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(next))
    } catch {
      // see above — the choice still applies to this render.
    }
  }, [])

  const shownId = picked ?? props.openingSectionId
  const section = props.sections.find((s) => s.id === shownId) ?? null
  const isDetail = picked !== null

  // ⚖ Liam 8/23 — 画面の説明. A section joins the walk by DECLARING
  // `data-guide-title` + `data-guide` ON ITSELF, so there is no list to keep in
  // sync: what renders is what is explained, and what the band or the open
  // section hides drops out of the walk and out of the N/M count by itself.
  //
  // ⚠ THE WALK IS DECLARED ON ROWS, NOT ON THE WHOLE PANEL, and that is a
  // placement decision as much as a teaching one: a target taller than the
  // viewport leaves the engine's card nowhere to go but on top of the thing it is
  // explaining (the room-5 F5 defect). Rows are short, so every step has a free
  // side — and 「what does THIS dial do」 is the question a settings page is
  // actually asked.
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
    // stacked dial row is full width and taller than half the viewport, so the
    // engine had nowhere to put the card but on top of the row — measured, and
    // then fixed, rather than argued away.
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

  /** A refused control, spelled ONCE. `aria-disabled` rather than `disabled`: the
   *  control stays focusable so its reason is reachable by keyboard and screen
   *  reader. The reason rides the ACCESSIBLE NAME as well as the title, because a
   *  screen reader drops `title` once a description is present.
   *  ⚠ THE CLASSES ARE MERGED HERE and a call site must never write `className`
   *  after the spread — the room-5 F-K1 defect, which is why the merge is last. */
  const refused = (label: string, reason: string, className?: string) => ({
    type: 'button' as const,
    'aria-disabled': 'true' as const,
    title: reason,
    'aria-label': `${label} — ${reason}`,
    className: ['st-opt', className].filter(Boolean).join(' '),
  })

  const groups: string[] = []
  for (const row of props.rail) if (!groups.includes(row.group)) groups.push(row.group)

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
          data-guide="設定の一覧です。「準備中」はこれから作るところ、「権限がありません」はいまのアカウントでは開けないところです。"
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
                    {row.state === 'soon' && <span className="st-flag">準備中</span>}
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
                <div className="st-cols">
                  <div className="st-main">
                    {section.prefs && <PrefsBlock prefs={prefs} onChange={savePrefs} />}

                    {section.dials.map((row) => (
                      <section
                        className="st-dial"
                        key={row.id}
                        data-guide-title={row.label}
                        data-guide={`${row.description} ${row.trio.guardrail}`}
                      >
                        <div className="st-dial-what">
                          <b>{row.label}</b>
                          <span className="st-scope">{row.scopeLabel}</span>
                        </div>
                        <div className="st-dial-ctl">
                          <Control row={row} refused={refused} />
                        </div>
                        {/* ⚠ A SIBLING OF THE LABEL, NOT A CHILD OF IT. At the
                            LEVEL band the label sits in a 140px column and the
                            description would be a column of syllables inside it;
                            as its own grid child it spans both columns. */}
                        <p className="st-dial-desc">{row.description}</p>
                        {/* ⚖ 8/21 — the trio, and all three lines always show. A
                            dial whose guardrail is invisible is a dial a manager
                            can hurt their own shop with. */}
                        <ul className="st-trio">
                          <li className="st-trio-base">{row.trio.base}</li>
                          <li className="st-trio-rail">{row.trio.guardrail}</li>
                          <li className="st-trio-type">{row.trio.businessType}</li>
                        </ul>
                        {/* ⚠ THE REASON IS VISIBLE TEXT, not only a title. A
                            refused control whose reason lives in a tooltip is a
                            dead lever to everyone who does not hover it. */}
                        <p className="st-why">{row.refusal}</p>
                      </section>
                    ))}

                    {section.soon && (
                      <section
                        className="st-soon"
                        data-guide-title="準備中について"
                        data-guide="この画面はこれから作ります。いま同じことができる場所があるときは、その場所を書いています。"
                      >
                        <h3>{section.soon.title}</h3>
                        <ul className="st-soon-list">
                          {section.soon.willCarry.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        <p className="st-soon-today">{section.soon.body}</p>
                      </section>
                    )}
                  </div>

                  {section.aside && (
                    <aside
                      className="st-aside"
                      data-guide-title={section.aside.title}
                      data-guide="この画面が出している値の出どころです。まだつないでいないものは、その行に理由を書いています。"
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
              )}

              {/* ⚠ THE 保存 SENTENCE BELONGS TO STORE SECTIONS ONLY. Printing it
                  under 自分の表示設定 — which really does save — would be the page
                  contradicting the control the reader just used. */}
              {section.scope === 'store' && section.gate === 'open' && <p className="st-foot">{props.noSaveLine}</p>}
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

/** The three control shapes this room needs, and no more. Each renders the
 *  STORE'S OWN CURRENT VALUE and refuses the change — a segmented control shows
 *  which option is live, a switch shows which side it is on, and a readout is for
 *  a value that is not one of a short list of choices. */
function Control({
  row,
  refused,
}: {
  row: DialRow
  refused: (label: string, reason: string, className?: string) => Record<string, unknown>
}) {
  const c = row.control
  if (c.kind === 'segment') {
    return (
      <div className="st-seg" role="group" aria-label={row.label}>
        {c.options.map((opt) => {
          const on = opt.value === c.current
          return (
            <button
              key={opt.value}
              {...(refused(`${row.label}を「${opt.label}」にする`, row.refusal, on ? 'is-on' : undefined) as Record<string, never>)}
              aria-pressed={on}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }
  if (c.kind === 'switch') {
    return (
      <div className="st-switchline">
        <span className={`st-state${c.on ? ' is-on' : ''}`}>{c.on ? c.onLabel : c.offLabel}</span>
        <button
          {...(refused(`${row.label}を切り替える`, row.refusal, 'st-switch') as Record<string, never>)}
          role="switch"
          aria-checked={c.on}
        />
      </div>
    )
  }
  return (
    <div className={`st-readout${c.numeric ? '' : ' is-phrase'}`}>
      <b>{c.text}</b>
      {c.unit && <span>{c.unit}</span>}
    </div>
  )
}

/** 自分の表示設定 — THE ONE BLOCK ON THIS PAGE THAT REALLY SAVES.
 *
 *  ⚠ IT IS ALSO THE ROOM'S PROOF. It sits inside a group full of permission-gated
 *  store sections and is reachable with NO permission at all, because `gateOf`
 *  answers `open` for a self-scoped section before it looks at access. If a later
 *  round ever gates the page rather than the section, these controls disappear
 *  for a staff member — which is the map's (d) gap, and the suite's mutation
 *  battery kills exactly that edit. */
function PrefsBlock({ prefs, onChange }: { prefs: Prefs; onChange: (p: Prefs) => void }) {
  return (
    <section
      className="st-prefs"
      data-guide-title="自分の表示設定"
      data-guide="ボードの見え方の好みです。ここだけは本当に保存されます。保存先はこの端末のこのブラウザで、ほかのスタッフの画面は変わりません。"
    >
      <div className="st-pref-row">
        <div className="st-dial-what">
          <b>密度</b>
          <span className="st-dial-desc">ボードの予約カードの間隔です。</span>
        </div>
        <div className="st-seg" role="group" aria-label="密度">
          {DENSITY_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={`st-opt${prefs.density === value ? ' is-on' : ''}`}
              aria-pressed={prefs.density === value}
              onClick={() => onChange({ ...prefs, density: value })}
            >
              {DENSITY_LABEL[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="st-pref-row">
        <div className="st-dial-what">
          <b>強調</b>
          <span className="st-dial-desc">予約カードの状態をどれくらい強く見せるかです。</span>
        </div>
        <div className="st-seg" role="group" aria-label="強調">
          {EMPHASIS_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              className={`st-opt${prefs.emphasis === value ? ' is-on' : ''}`}
              aria-pressed={prefs.emphasis === value}
              onClick={() => onChange({ ...prefs, emphasis: value })}
            >
              {EMPHASIS_LABEL[value]}
            </button>
          ))}
        </div>
      </div>

      {/* ⚠ A LIVE CONTROL HAS TO SHOW ITS EFFECT (the dead-lever law). canon puts
          a preview panel under these two, and so does this room: the rows below
          really change shape as the reader presses, which is the whole difference
          between this block and every refused row above it. */}
      <div className="st-preview" data-density={prefs.density} data-emphasis={prefs.emphasis} aria-label="見え方のプレビュー">
        <div className="st-pv-note">いまの設定での見え方</div>
        <div className="st-pv-row"><span>10:00 佐藤 様</span><span>カット</span></div>
        <div className="st-pv-row"><span>11:30 田中 様</span><span>カラー</span></div>
        <div className="st-pv-row"><span>13:00 鈴木 様</span><span>トリートメント</span></div>
      </div>
      {/* ⚠ NO `=` AND NO CODE. 「密度=ゆったり」 is how a config file talks; this
          line is read by a receptionist. */}
      <p className="st-pref-saved">
        いまの設定は「{DENSITY_LABEL[prefs.density]}・{EMPHASIS_LABEL[prefs.emphasis]}」です。この端末に保存しました。
      </p>
    </section>
  )
}

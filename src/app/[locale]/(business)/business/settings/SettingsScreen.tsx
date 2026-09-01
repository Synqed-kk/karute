'use client'

// 予約と確保 — the room's surface. ⚖ Liam 9/1: the approved `settings-mock.html`
// is the spec, and its anatomy is presets → live preview → 詳細設定, with the
// mock's own one-line description under every dial (⚖ HIS 8/31 GENERAL LAW:
// 「every settings entry carries a one-line description of what it changes/turns
// off」).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'

const ROOT = 'page pg-settings'

export interface SettingsProps {
  storeKey: string
  storeLabel: string
  policy: {
    /** ⚖ 9/1 — core `gap_guard_mode` STRICT vs STANDARD, which is the engine
     *  half of the mock's 「店長のみでも警告を止める」 dial. */
    strict: boolean
    /** core `new_client_session_minutes`. */
    newClientMinutes: number
  }
}

/** ⚖ Liam 8/23 — 画面の説明. The family's own tour helpers, carried at the same
 *  shape: a rect literal the shared engine understands, and two identity guards
 *  that keep the measuring effect from re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

export function SettingsScreen(props: SettingsProps) {
  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  // View state: the walk explains the page and writes nothing.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  // The tour's own nodes: the room root it walks, the ? it came from and goes
  // back to, the card it measures, and the 次へ it hands the keyboard.
  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`) and
   *  wired exactly as 受信トレイ / 売上・レジ / カルテ wire it.
   *
   *  THE REGISTRY. A section joins the walk by declaring `data-guide-title` +
   *  `data-guide` ON ITSELF, so there is no steps table to keep in sync — which
   *  in THIS room is the whole point: every dial is its own `<section>`, so a
   *  dial added in a later round is explained the day it lands and one hidden
   *  behind a permission drops out of the count by itself.
   *
   *  The walk is scoped to the ROOM's own root rather than the document: the
   *  shell's rail and topbar are not this page. */
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    // A step off screen is scrolled to before it is measured, or the spotlight
    // would cut its hole in empty space. The PAGE scrolls (⚖ page-scroll).
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    // BOTH writes are identity-guarded, and `tourStep` is its own dependency:
    // the effect runs a second time ONLY so the card can be measured carrying
    // this step's real text, and a fresh object every pass would be an infinite
    // render loop.
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const at = spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // While the tour is up it owns Escape, and the arrows walk the ring. Bound
  // only while it IS open, and removed with it.
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
  // under it — a scroll, a resize — has to re-measure.
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
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts focus
  // back on the ? it came from. `wasOpen` keeps the close half from firing on the
  // first render, when nothing was open and nothing should move.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasOpen.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  return (
    <div className={ROOT} ref={rootRef}>
      <div className="st-measure">
        {/* STEP 0. The head declares itself like every other section, so the walk
            opens on what this page is FOR before it starts pointing at parts of
            it — the 受信トレイ precedent, and the reason the mock's two lead
            paragraphs stay short here. */}
        <header
          className="st-head"
          data-guide-title="予約と確保"
          data-guide="この店舗の予約と確保のルールを、まとめて決める画面です。まずプリセットを選び、変えたいところだけ詳細設定で直します。右のカードは、いまの設定でスタッフの画面に出るものです。"
        >
          <div className="st-titleline">
            <h1>予約と確保</h1>
            {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one every
                other Business room has. A hairline circle, never a filled one
                (⚖ R13). */}
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
          {/* The mock's own two lead lines, verbatim. */}
          <p className="st-lead">予約と確保のルールを、ここでまとめて決めます。まずは3つのプリセットから選び、直したいところだけ詳細設定で変えられます。</p>
          <p className="st-lead">右のカードは、いまの設定でスタッフの画面に出てくるものです。</p>
        </header>

        <div className="st-wrap">
          <section
            className="st-col-presets"
            aria-labelledby="stPresetsLabel"
            data-guide-title="プリセット"
            data-guide="よくある決め方を3つ用意しています。押すと下の詳細設定がまとめて切り替わります。名指しロックだけは個人ごとの例外なので、プリセットでは変わりません。"
          >
            <div className="st-sec-h">
              <p className="st-sec-l" id="stPresetsLabel">プリセット</p>
            </div>
            <p className="st-sec-d">よくある決め方を3つ用意しました。選ぶと、下の詳細設定がまとめて変わります。</p>
          </section>

          <section
            className="st-col-preview"
            aria-labelledby="stPreviewLabel"
            data-guide-title="スタッフが見るカード"
            data-guide="いまの設定で、確保枠を壊す場所に予約を置こうとしたスタッフに出るカードです。表示だけで、ここから予約は動きません。見本の操作者を切り替えると、権限による見え方の違いも確認できます。"
          >
            <div className="st-sec-h">
              <p className="st-sec-l" id="stPreviewLabel">スタッフが見るカード</p>
              <span className="st-chip">表示のみ</span>
            </div>
          </section>

          <section
            className="st-col-adv"
            aria-labelledby="stAdvLabel"
            data-guide-title="詳細設定"
            data-guide="プリセットで決まった内容を、一つずつ直せる場所です。ここで変えるとプリセットの表示はカスタムに変わります。"
          >
            <div className="st-sec-h">
              <p className="st-sec-l" id="stAdvLabel">詳細設定</p>
            </div>
            <p className="st-sec-d">一つずつ変えられます。{props.storeLabel}の設定です。</p>
          </section>
        </div>
      </div>

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. */}
      {tourOpen && (
        <>
          <div
            className="st-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // A tap on nothing declared ends the tour — the dim layer behaves
              // like the scrim it looks like.
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

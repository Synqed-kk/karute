'use client'

// カードの見た目 (⚖ A1b) — the curated 12-colour picker and the live Reserve card beside it.
//
// ONE CARD DRAWING: the preview is the verified port (`ReserveCardPreview`, pixel-proven against Reserve
// @ c2a9f95); this file draws no card of its own, and each swatch dot is painted from the port's own
// `satinVars` — one colour math. ONE SAVE STORY: the picked colour is a value in the ROOM's own values map
// (`CARD_COLOR_ID`), so 変更 n件, the dot and 保存する treat it like every other control; nothing reaches core
// (A2 is the write). Like 予約と確保, the section hands its two pieces back as SLOTS and the room places them:
// the picker in the reading column, the card at the top of the sticky stack (below the picker at ② and ①).
// Every Japanese string is the switchboard mock's (S40 1b-1), or JP-COPY-A1-FINAL's with Reserve → お客様のアプリ.
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { wrapStep } from '@/business/lib/guide'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { satinVars } from '@/business/lib/reserve-card/satin-material'
import { STORES, type StorePageSample } from '@/business/lib/reserve-card/store-page-sample'
import { honestLines, publicProjection, type CapRecord, type Counts } from '@/business/lib/store-page/model'
import { makeSpring, type Spring } from '@/business/lib/spring'
import type { SettingsSection } from '@/business/lib/settings'

type Look = NonNullable<SettingsSection['cardLook']>
type View = 'home' | 'store'
/** The お店ページ section's live draft (THE SHARED SHAPE, PACKETS-S50-WAVE3 :8): the room builds it from its values. */
/** `sampleKey` = the payload's `storePage.sampleKey` (R189): the sample `counts` were computed for (the saved / seed type). */
export type StoreView = { draft: CapRecord; counts: Counts; sampleKey: NonNullable<SettingsSection['storePage']>['sampleKey'] }

/** What a reader can type to find this section (the room's search), like STORE_POLICY_HEADINGS. */
export const CARD_LOOK_HEADINGS: ReadonlyArray<string> = ['カードの見た目', 'カードの色', 'お客様のアプリでの見え方']

/** The stand-in the preview paints when no colour is set (note.empty.preview says so). */
export const STAND_IN = '#1C2247'
/** Reserve's phone width: the preview is laid out at exactly this, and only ever scaled DOWN to fit. */
const PHONE_W = 393

/** Which state line a value earns (contract §8): nothing set · one of the 12 · a colour set outside them. */
export function cardLookState(value: string | null, palette: Look['palette']): 'empty' | 'set' | 'legacy' {
  if (value === null) return 'empty'
  return palette.some((c) => c.hex === value) ? 'set' : 'legacy'
}

/** The radiogroup's roving focus: arrows step with wrap, Home/End jump; any other key → null. */
export function nextSwatch(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return wrapStep(i + 1, n)
  if (key === 'ArrowLeft' || key === 'ArrowUp') return wrapStep(i - 1, n)
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}

/** The phone's paint scale in a column `stripWidth` wide: never above 1:1 (a strip wider than a phone
 *  must not blow the card up), and a column not laid out yet (≤ 0) keeps 1:1. */
export function fitScale(stripWidth: number, phoneW = PHONE_W): number {
  return stripWidth <= 0 ? 1 : Math.min(1, stripWidth / phoneW)
}

const satin = (hex: string) => satinVars(hex) as CSSProperties

/** The phone's お店ページ inputs from the draft: its PUBLIC projection (a sub ON only while its parent is ON, D4)
 *  + the practice sample the payload names (`sampleKey`, R189: the one its counts were computed for; an unsaved 業種 pick
 *  does not change it until saved) drawn with the payload's
 *  counts. A count the room does not know stays undefined → ready() = false → no block, no number (R101). */
export function storeViewInputs(sv: StoreView): { on: ReadonlySet<string>; sample: StorePageSample; honest: string[] } {
  const base: StorePageSample = STORES[sv.sampleKey]
  // the sample's counts are P1's Counts (R185): the body reads them only through P1's ready(), which takes unknowns
  const sample = { ...base, counts: sv.counts }
  // spec E2 (renderHonest :1947-1958); P1's pending() takes an UNKNOWN count as not pending, so no line claims a number (R101)
  const honest = honestLines(sv.draft, sv.counts)
  return { on: new Set(publicProjection('', sv.draft).on), sample, honest }
}

export function ReserveCardLookSection({
  look,
  value,
  onPick,
  reduced,
  render,
  storeView,
}: {
  look: Look
  /** The room's LIVE value for `CARD_COLOR_ID` ('' = nothing set). */
  value: string
  onPick: (hex: string) => void
  reduced: boolean
  render: (slots: { main: ReactNode; preview: ReactNode }) => ReactNode
  /** the お店ページ draft (P7 wires it); absent = the cover only, exactly as before */
  storeView?: StoreView
}) {
  const [view, setView] = useState<View>('home')
  const shown = value === '' ? null : value
  // The source line speaks for the SAVED colour (mock :1340), never the unsaved pick; the preview follows the pick.
  const saved = look.value === '' ? null : look.value
  const state = cardLookState(saved, look.palette)
  const checked = look.palette.findIndex((c) => c.hex === shown)
  // The roving tab stop FOLLOWS FOCUS (Greptile #1015): arrows move focus and the stop with it, and only a
  // click / Space / Enter picks — browsing must not dirty the save bar. It starts on the checked swatch.
  const [focusAt, setFocusAt] = useState(() => Math.max(checked, 0))
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([])

  // The view switch cross-fades on the room's ONE spring (never a second easing); reduced motion lands at once.
  const phoneRef = useRef<HTMLDivElement>(null)
  const fade = useRef<Spring | null>(null)
  const firstView = useRef(true)
  useLayoutEffect(() => {
    const s = makeSpring((v) => { if (phoneRef.current) phoneRef.current.style.opacity = String(Math.min(1, Math.max(0, v))) }, { reduced, eps: 0.004 })
    fade.current = s
    return () => s.stop()
  }, [reduced])
  useLayoutEffect(() => {
    if (firstView.current) { firstView.current = false; return }
    const live = Number(phoneRef.current?.style.opacity)
    fade.current?.jump(Number.isFinite(live) && live < 1 ? live : 0)
    fade.current?.set(1)
    if (phoneRef.current) phoneRef.current.scrollTop = 0 // each view opens at its top, as the mock's own layer does
  }, [view])

  // ⚖ R-A1b-1 — a column narrower than the phone (the shell's icon rail at 393/440) SCALES the phone down
  // to fit: never a pan, never a clip. The layout stays 393px, so the port's own measure effects see
  // Reserve's geometry; only the paint shrinks, and the strip's height follows so the notes never overlap.
  // ⚖ 1b-2 B3 — the scaled box is the phone FRAME (the mock's .phoneframe, a fixed 393×760 viewport); the app
  // scrolls INSIDE it (.cl-phone = the mock's .pv), so the page never grows with the card list.
  // ⚖ S46 — the script writes PAINT ONLY (`--cl-scale`, a transform): the strip's height is CSS (settings.css),
  // because a height written here would feed the side column's scrollbar, and that bar back into the width.
  const stripRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const fit = () => {
      const scale = fitScale(strip.clientWidth)
      // 1:1 carries NO transform at all (the unset var leaves `transform` at none), so the proven pixels stand
      if (scale === 1) strip.style.removeProperty('--cl-scale')
      else strip.style.setProperty('--cl-scale', String(scale))
    }
    const ro = new ResizeObserver(fit) // the strip's width (the frame's box is fixed, so it is not observed)
    ro.observe(strip)
    return () => ro.disconnect()
  }, [])

  // The honest slot (mock renderHonest :1947-1958): only lines that are true right now; none → no block.
  // ONLY a card edit moves the view (SPECCHECK fix 1): a switch flip, type pick, 戻す or save changes `storeView`
  // and nothing else, so the view the owner is looking at stays put.
  const store = storeView ? storeViewInputs(storeView) : null
  const honest = [
    ...(shown === null ? ['色が設定されていないため、見本では仮に紺で表示しています。実際のお客様のアプリのカードとは色が異なる場合があります。'] : []),
    ...(store?.honest ?? []),
  ]

  const pick = (hex: string, i: number) => {
    onPick(hex)
    setFocusAt(i)
    setView('home') // mock M21: a pick shows the Home card
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = nextSwatch(e.key, i, look.palette.length)
    if (next === null) return
    e.preventDefault()
    setFocusAt(next)
    swatchRefs.current[next]?.focus()
  }
  // Pointer shortcuts on the picture itself (mock M43): the big card opens the store page, the cover's
  // ホーム pill goes back. The keyboard path is the view switch above it; the picture is aria-hidden.
  const onPhoneClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as Element
    if (t.closest('.mcard')) setView('store')
    else if (t.closest('.salon-cover__back')) setView('home')
  }

  const main = (
    <section className="st-block" data-guide-title="カードの色" data-guide="カードの色を12色から1つ選びます。押すと、見本のカードがその色になります。">
      <div className="st-block-head">
        <h3 id="clLookHead">カードの見た目</h3>
        <span className="st-scope" title="この事業者のすべての店舗に適用されます">{look.scopeLabel}</span>
      </div>
      <p className="st-block-note">お客様のアプリのホームに並ぶ、お店のカードです。色を選べます。文字の位置や大きさは、どのお店でも同じです。</p>
      <h4 className="st-sec-l" id="clPickHead">カードの色</h4>
      <div className="cl-swatches" role="radiogroup" aria-labelledby="clPickHead">
        {look.palette.map((c, i) => (
          <button
            key={c.hex}
            ref={(el) => { swatchRefs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={i === checked}
            aria-label={c.name}
            tabIndex={i === focusAt ? 0 : -1}
            className={`st-swatch cl-swatch${i === checked ? ' is-on' : ''}`}
            onClick={() => pick(c.hex, i)}
            onKeyDown={(e) => onKey(e, i)}
            onFocus={() => setFocusAt(i)}
          >
            {/* the button is neutral chrome; the colour is CONTENT inside it (no colour-filled control) */}
            <span className="cl-swatch__fill" aria-hidden="true" style={satin(c.hex)}>
              {i === checked && (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </span>
          </button>
        ))}
      </div>
      {/* the source line (mock #clSrc): core sends no change date, so a saved non-standard colour prints none */}
      {(state !== 'set' || saved === STAND_IN) && (
        <p className="cl-state">
          {state === 'legacy' && saved !== null && <span className="cl-dot" style={satin(saved)} title="現在の色" aria-hidden="true" />}
          {state === 'empty'
            ? '色はまだ設定されていません。お客様のアプリのカードは、これまでどおりの色で表示されます。'
            : state === 'set'
              ? '標準の色'
              : '現在の色は、以前に設定された色で、12色には含まれていません。12色のどれかを選ぶまで、この設定は変わりません。'}
        </p>
      )}
    </section>
  )

  const preview = (
    <section
      className="cl-preview"
      aria-labelledby="clPvHead"
      data-guide-title="お客様のアプリでの見え方"
      data-guide="選んだ色で、お店のカードがお客様のアプリでどう見えるかの見本です。表示だけで、ここを押しても設定は変わりません。「ホーム」と「お店ページ」を切り替えると、それぞれの画面での見え方を確認できます。"
    >
      <div className="st-sec-h">
        <p className="st-sec-l" id="clPvHead">お客様のアプリでの見え方</p>
        <span className="st-chip">表示のみ</span>
      </div>
      <div className="sp-seg" role="group" aria-labelledby="clPvHead">
        <button type="button" className={view === 'home' ? 'on' : undefined} aria-pressed={view === 'home'} onClick={() => setView('home')}>ホーム</button>
        <button type="button" className={view === 'store' ? 'on' : undefined} aria-pressed={view === 'store'} onClick={() => setView('store')}>お店ページ</button>
      </div>
      {/* TRUE PHONE SIZE wherever the column holds 393px; narrower, the same 393px phone is scaled to fit. */}
      <div className="cl-strip" ref={stripRef}>
        <div className="cl-frame">
          <div className="cl-phone" ref={phoneRef} aria-hidden="true" tabIndex={-1} onClick={onPhoneClick}>
            <ReserveCardPreview name={look.storeLine} storeLine={look.storeLine} address={look.address} cardColor={shown} primaryColor={STAND_IN} view={view} on={store?.on} sample={store?.sample} />
          </div>
        </div>
      </div>
      {view === 'home' && <p className="st-pv-cap">見本では、編集中のお店を大きいカードにしています。実際のアプリでは、次のご予約が近いお店が大きいカードになります。</p>}
      {view === 'home' && <p className="st-pv-cap">カードを開く動きは、この見本だけのものです。</p>}
      {honest.length > 0 && <div className="cl-honest">{honest.map((line) => <p key={line}>{line}</p>)}</div>}
    </section>
  )

  return <>{render({ main, preview })}</>
}

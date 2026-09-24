'use client'

// カードの見た目 (⚖ A1b) — the curated 12-colour picker and the live Reserve card beside it.
//
// ONE CARD DRAWING: the preview is the verified port (`ReserveCardPreview`, pixel-proven against Reserve
// @ c2a9f95); this file draws no card of its own, and each swatch dot is painted from the port's own
// `satinVars` — one colour math. ONE SAVE STORY: the picked colour is a value in the ROOM's own values map
// (`CARD_COLOR_ID`), so 変更 n件, the dot and 保存する treat it like every other control; nothing reaches core
// (A2 is the write). Like 予約と確保, the section hands its two pieces back as SLOTS and the room places them:
// the picker in the reading column, the card at the top of the sticky stack (below the picker at ② and ①).
// Every Japanese string is JP-COPY-A1-FINAL's, byte for byte, by id.
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { wrapStep } from '@/business/lib/guide'
import { ReserveCardPreview } from '@/business/lib/reserve-card/ReserveCardPreview'
import { satinVars } from '@/business/lib/reserve-card/satin-material'
import { makeSpring, type Spring } from '@/business/lib/spring'
import type { SettingsSection } from '@/business/lib/settings'

type Look = NonNullable<SettingsSection['cardLook']>
type View = 'home' | 'store'

/** What a reader can type to find this section (the room's search), like STORE_POLICY_HEADINGS. */
export const CARD_LOOK_HEADINGS: ReadonlyArray<string> = ['カードの色', 'Reserveでの見え方']

/** The stand-in the preview paints when no colour is set (note.empty.preview says so). */
const STAND_IN = '#1C2247'
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

export function ReserveCardLookSection({
  look,
  value,
  onPick,
  reduced,
  render,
}: {
  look: Look
  /** The room's LIVE value for `CARD_COLOR_ID` ('' = nothing set). */
  value: string
  onPick: (hex: string) => void
  reduced: boolean
  render: (slots: { main: ReactNode; preview: ReactNode }) => ReactNode
}) {
  const [view, setView] = useState<View>('home')
  const shown = value === '' ? null : value
  const state = cardLookState(shown, look.palette)
  const checked = look.palette.findIndex((c) => c.hex === shown)
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
  }, [view])

  // ⚖ R-A1b-1 — a column narrower than the phone (the shell's icon rail at 393/440) SCALES the phone down
  // to fit: never a pan, never a clip. The layout stays 393px, so the port's own measure effects see
  // Reserve's geometry; only the paint shrinks, and the strip's height follows so the notes never overlap.
  // `is-scaled` (toggled here, in the same frame as the vars) swaps the strip's 1:1 scroller for a clip;
  // React never rewrites this element's static className, so the toggle stands. Runs both ways on resize.
  const stripRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const strip = stripRef.current, phone = phoneRef.current
    if (!strip || !phone) return
    const fit = () => {
      const scale = fitScale(strip.clientWidth)
      strip.classList.toggle('is-scaled', scale < 1)
      // 1:1 carries NO transform at all (the unset var leaves `transform` at none), so the proven pixels stand
      if (scale === 1) { strip.style.removeProperty('--cl-scale'); strip.style.removeProperty('--cl-h'); return }
      strip.style.setProperty('--cl-scale', String(scale))
      strip.style.setProperty('--cl-h', `${phone.offsetHeight * scale}px`)
    }
    const ro = new ResizeObserver(fit) // the strip's width and the phone's height (the view switch)
    ro.observe(strip)
    ro.observe(phone)
    return () => ro.disconnect()
  }, [])

  const pick = (hex: string) => {
    onPick(hex)
    setView('home') // mock M21: a pick shows the Home card
  }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = nextSwatch(e.key, i, look.palette.length)
    if (next === null) return
    e.preventDefault()
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
        <h3 id="clPickHead">カードの色</h3>
        <span className="st-scope">{look.scopeLabel}</span>
      </div>
      <p className="cl-state">
        {state === 'legacy' && shown !== null && <span className="cl-dot" style={satin(shown)} title="現在の色" aria-hidden="true" />}
        {state === 'empty'
          ? '色はまだ設定されていません。Reserveのカードは、これまでどおりの色で表示されます。'
          : state === 'set'
            ? `現在の色は「${look.palette[checked].name}」です。`
            : '現在の色は、以前に設定された色で、12色には含まれていません。12色のどれかを選ぶまで、この設定は変わりません。'}
      </p>
      <p className="st-block-note">用意した12色から選びます。店名の位置や文字の大きさは、どのお店のカードでも同じです。</p>
      <div className="cl-swatches" role="radiogroup" aria-labelledby="clPickHead">
        {look.palette.map((c, i) => (
          <button
            key={c.hex}
            ref={(el) => { swatchRefs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={i === checked}
            aria-label={c.name}
            tabIndex={i === Math.max(checked, 0) ? 0 : -1}
            className={`st-swatch cl-swatch${i === checked ? ' is-on' : ''}`}
            onClick={() => pick(c.hex)}
            onKeyDown={(e) => onKey(e, i)}
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
    </section>
  )

  const preview = (
    <section
      className="cl-preview"
      aria-labelledby="clPvHead"
      data-guide-title="Reserveでの見え方"
      data-guide="選んだ色で、お店のカードがReserveでどう見えるかの見本です。表示だけで、ここを押しても設定は変わりません。「ホーム」と「お店ページ」を切り替えると、それぞれの画面での見え方を確認できます。"
    >
      <div className="st-sec-h">
        <p className="st-sec-l" id="clPvHead">Reserveでの見え方</p>
        <span className="st-chip">表示のみ</span>
      </div>
      <div className="sp-seg" role="group" aria-labelledby="clPvHead">
        <button type="button" className={view === 'home' ? 'on' : undefined} aria-pressed={view === 'home'} onClick={() => setView('home')}>ホーム</button>
        <button type="button" className={view === 'store' ? 'on' : undefined} aria-pressed={view === 'store'} onClick={() => setView('store')}>お店ページ</button>
      </div>
      {/* TRUE PHONE SIZE wherever the column holds 393px; narrower, the same 393px phone is scaled to fit. */}
      <div className="cl-strip" ref={stripRef}>
        <div className="cl-phone" ref={phoneRef} aria-hidden="true" onClick={onPhoneClick}>
          <ReserveCardPreview name={look.businessName} storeLine={look.storeLine} address={look.address} cardColor={shown} primaryColor={STAND_IN} view={view} />
        </div>
      </div>
      <p className="st-pv-cap">見本では、大きいカードも小さいカードも、このお店のものを表示しています。実際のReserveでは、次のご予約がいちばん近いお店が大きいカードになります。</p>
      <p className="st-pv-cap">カードを開くときの動きは見本用のもので、実際のReserveの動きとは異なります。</p>
      {shown === null && <p className="st-pv-cap">色が設定されていないため、見本では仮に紺で表示しています。実際のReserveのカードとは色が異なる場合があります。</p>}
    </section>
  )

  return <>{render({ main, preview })}</>
}

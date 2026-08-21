// CANON-LOGIC — dynamic-pricing simulation, lifted from fable-store-today.html.
//
// WHY THIS FILE EXISTS (⚖ parity-wave architecture directive): canon's inline
// script is where the board's pricing BEHAVIOUR is defined. Re-deriving it here
// would be a second opinion; this is the same arithmetic, near-verbatim, as
// pure functions. The React screen calls these and owns only DOM plumbing.
//
// WHAT IS NOT CARRIED: canon's data. `SELL_LIST` there is a map of canon's own
// staff names to yen; here the list price arrives from OUR fixtures through
// `listPriceFor`. The CURVE is algorithm, not data — canon's own comment calls
// its shape invariant and only the depth a store setting — so the shape rides
// along, keyed by hour.
//
// Canon source lines: 3046–3094 (the dialog's clamp/notes/captions), 4830–4844
// (priceAt), 4992–5032 (gap-fill and packed-session pricing), 5340–5353
// (priceLabel and the three-tier zoning).

/** 時間別価格カーブ (canon `SELL_CURVE`, :4837). Hour of day → multiplier.
 *  Canon: 「カーブはサンプル手付け — 実装は Reserve が夜間バッチで予約実績から
 *  学習・導出」. The shape is the algorithm; the depth is the store's lever. */
export const SELL_CURVE: Record<number, number> = {
  10: 0.85, 11: 0.88, 12: 0.95, 13: 0.92, 14: 0.85, 15: 0.85,
  16: 0.92, 17: 1, 18: 1, 19: 0.95, 20: 0.9,
}

/** canon `CURVE_MAX_DIP` (:4838) — how far the curve dips at its deepest, so
 *  that a store's 0–30% depth setting stretches the whole curve rather than
 *  clipping it. */
export const CURVE_MAX_DIP = 1 - Math.min(...Object.values(SELL_CURVE))

/** canon `DENSITY_CEILING` (:4845). A fixed rule, deliberately not a setting:
 *  more visible sell bands than this means the day is fragmented, and the tint
 *  mode degrades to drag-only rather than turning the board into confetti. */
export const DENSITY_CEILING = 12

/** canon `SELL_SLOT_MIN` (:4867). One sellable window is one hour. */
export const SELL_SLOT_MIN = 60

/** canon's ¥ formatter (`money`, :2736) — same output as the board's `yen`. */
export const money = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`

export interface PriceFrame {
  /** The store's 最高価格 lever, already clamped into the HQ band. */
  hi: number
  /** The store's 最低価格 lever, already clamped to ≥ hi × 0.7. */
  lo: number
  /** HQ's own band — the only range the store may move `hi` inside. */
  hqMin: number
  hqMax: number
}

/** canon `priceAt` (:4839). 定価 scaled by the store's 最高価格 lever, then
 *  discounted by how far this hour dips below the curve's peak, stretched by
 *  the store's depth setting. Rounded to ¥10 exactly once, at the end. */
export function priceAt(listPrice: number, hour: number, hiPrice: number, hqBase: number, discountDepth: number): number {
  const list = listPrice * (hiPrice / hqBase)
  const depth = ((1 - (SELL_CURVE[hour] ?? 1)) / CURVE_MAX_DIP) * (discountDepth / 100)
  return Math.round((list * (1 - depth)) / 10) * 10
}

/** canon `clampPriceInputs` (:3046) — the guardrail the Reserve dialog's
 *  sentence describes: 最高価格 inside HQ's band, 最低価格 no lower than
 *  最高価格 × 0.7. **This is where the −30% floor comes from**; the dialog's
 *  copy quotes this function rather than restating a number. */
export function clampPriceInputs(
  hiRaw: number | string | null | undefined,
  loRaw: number | string | null | undefined,
  frame: Pick<PriceFrame, 'hqMin' | 'hqMax'> & { base?: number },
): { hi: number; lo: number; floor: number } {
  /** canon guards with `Number(hiPrice.value || 7130)` / `Number(loPrice.value
   *  || 6270)` — the DOM-string idiom where FALSY MEANS "use the store's own
   *  default". `Number.isFinite` disagrees on both ends of that (zero is a real
   *  number; "6270" is not finite), and the two readings part company exactly
   *  where a database can hand us a null or a 0 base: canon shows the default
   *  最低価格 and the finite test dropped straight to the floor (ENGINE-DIFF
   *  P-2). Canon's reading wins, and canon's two defaults are the store's own
   *  numbers — HQ's ceiling and the store's 基準価格 — not literals. */
  const orDefault = (raw: number | string | null | undefined, fallback: number) => Number(raw || fallback)
  let hi = Math.round(orDefault(hiRaw, frame.hqMax) / 10) * 10
  hi = Math.min(frame.hqMax, Math.max(frame.hqMin, hi))
  const floor = Math.round((hi * 0.7) / 10) * 10
  let lo = Math.round(orDefault(loRaw, frame.base ?? floor) / 10) * 10
  lo = Math.min(hi, Math.max(floor, lo))
  return { hi, lo, floor }
}

/** The floor as a percentage off the ceiling — the number canon's guardrail
 *  sentence carries («最低価格を最高価格の−30%までの範囲で»). Computed, never
 *  typed: move the 0.7 in `clampPriceInputs` and this sentence follows. */
export function floorDiscountPercent(hi: number): number {
  const { floor } = clampPriceInputs(hi, 0, { hqMin: hi, hqMax: hi })
  return Math.round((1 - floor / hi) * 100)
}

/** canon `updatePrices` (:3084–3086): the two annotations beside the inputs. */
export function hqNote(hi: number, hqMin: number): string {
  const pct = Math.round((hi / hqMin - 1) * 100)
  return pct === 0 ? '標準' : `+${pct}%`
}

export function discountNote(hi: number, lo: number): string {
  return lo === hi ? '割引なし' : `−${Math.round((1 - lo / hi) * 100)}%`
}

/** canon `refreshPriceButton` (:3058). The caption is a STATUS: it says what
 *  the board is in, not what the button would do. An idle dialog reads
 *  「公開価格は変更されていません」 — that wording is the state, and swapping it
 *  for an imperative would report a pending change that does not exist. */
export function priceButtonCaption(openSlots: number, changed: boolean): string {
  if (openSlots === 0) return '公開枠なし'
  return changed ? `${openSlots}枠の公開価格を更新` : '公開価格は変更されていません'
}

/** canon `updateFramingSample` (:3068). Both framings price identically — only
 *  the anchor point and the vocabulary swap. */
export function framingSample(hi: number, lo: number, framing: 'discount' | 'markup'): string {
  const depthPct = Math.round((1 - lo / hi) * 100)
  if (depthPct === 0) {
    return '最低価格＝最高価格：全時間帯が定価表示になります（枠の実価格は同じ・Reserve側の表示に反映）'
  }
  const up = Math.round((hi / lo - 1) * 100)
  const head = framing === 'discount'
    ? `例: 定価 ${money(hi)} → 空き時間帯は最大−${depthPct}%（${money(lo)}）の割引表示`
    : `例: 基準 ${money(lo)} → 人気時間帯は+${up}%（${money(hi)}）の加算表示`
  return `${head}（枠の実価格は同じ・Reserve側の表示に反映）`
}

/** canon `gapFillRawTotal` (:4997). Pro-rate the hourly price across the span,
 *  hour by hour. Rounding happens once, later — rounding first and dividing
 *  after double-charges the remainder. */
export function gapFillRawTotal(listPrice: number, startMin: number, endMin: number, frame: PriceFrame, depth: number): number {
  let total = 0
  let cur = startMin
  while (cur < endMin) {
    const hourStart = Math.floor(cur / 60) * 60
    const segEnd = Math.min(endMin, hourStart + 60)
    total += priceAt(listPrice, Math.floor(cur / 60), frame.hi, frame.hqMin, depth) * ((segEnd - cur) / 60)
    cur = segEnd
  }
  return total
}

/** canon `gapFillFloorTotal` (:5010). HQ's maximum-discount line, pro-rated the
 *  same way. A スキマ割 is extra appeal, never a reason to leave HQ's band. */
export function gapFillFloorTotal(listPrice: number, minutes: number, frame: PriceFrame): number {
  return listPrice * (frame.hi / frame.hqMin) * 0.7 * (minutes / 60)
}

/** canon `gapFillPrice` (:5015): pro-rate → discount → floor-clamp → ¥10, once. */
export function gapFillPrice(listPrice: number, startMin: number, endMin: number, frame: PriceFrame, depth: number, discountPct: number): number {
  const raw = gapFillRawTotal(listPrice, startMin, endMin, frame, depth)
  const discounted = raw * (1 - discountPct / 100)
  const floor = gapFillFloorTotal(listPrice, endMin - startMin, frame)
  return Math.round(Math.max(discounted, floor) / 10) * 10
}

/** canon `packedPrice` (:5024): full price, no discount, no clamp — and the
 *  same tripwire canon keeps, because "structurally always above the floor"
 *  is only true while the depth cap holds. */
export function packedPrice(listPrice: number, startMin: number, endMin: number, frame: PriceFrame, depth: number): number {
  const price = Math.round(gapFillRawTotal(listPrice, startMin, endMin, frame, depth) / 10) * 10
  const floor = gapFillFloorTotal(listPrice, endMin - startMin, frame)
  if (price < floor) {
    throw new Error(
      `packed session price fell below the floor (¥${price} < ¥${Math.round(floor)}) — the discount-depth cap may have moved`,
    )
  }
  return price
}

/** canon `priceLabel` (:5340). A single-price box shows the price; a span shows
 *  「¥6,160〜」. Canon rejected the 「¥lo–hi」 form as first-read-as-a-bug. */
export function priceLabel(lo: number, hi: number): string {
  return lo === hi ? money(lo) : `${money(lo)}〜`
}

/** canon's three-tier zoning (:5350–5354). A day whose spread is under 5% of
 *  its own floor gets NO tiers — inventing zones out of rounding noise would be
 *  a false signal. Tier feeds `--tier`, which scales the wash's alpha. */
export function tierOf(price: number | null, mn: number, mx: number): 1 | 2 | 3 {
  if (price == null) return 1
  if (mx - mn < mn * 0.05) return 2
  if (price <= mn + (mx - mn) / 3) return 1
  if (price >= mx - (mx - mn) / 3) return 3
  return 2
}

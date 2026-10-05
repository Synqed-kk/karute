'use client'

// The card mark block (D-LOGO, DECISIONS-S49) — preview only until CORE-55 gives the mark a home in core.
// ONE square mark per business, shown as uploaded: a file input and 外す, nothing else (no seg, no radios,
// no A/B strip, no transparency rule). The picked mark goes OUT through `onMark` only; this block never
// touches the room's values map, so it is NOT counted as a change and NOT saved.
// S64 R239: `onMark` names its cause (picked · removed · refused) — a refused pick never reads as a removal.
// Strings: mock :773 「ロゴ」 · :1348 「ロゴ画像を選ぶ」 · :1364 「このロゴを使えます」 · :1366 「外す」;
// COPY-S49 L1–L5 (refusals, card-mark.ts) · L6 (practice line) · L7 (real business line).
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  MARK_HEAD_BYTES, MARK_REFUSAL, checkMarkFile, checkMarkSize, sniffMarkFormat, type MarkEvent, type MarkRefusal,
} from '@/business/lib/store-page/card-mark'
import './card-mark.css'

export const MARK_PRACTICE_LINE = 'ロゴはまだ保存できないため、選んだ画像は見本にだけ表示され、お客様のアプリには反映されません。' // COPY-S49 L6
export const MARK_REAL_LINE = 'ロゴの設定は準備中のため、まだ画像を選べません。' // COPY-S49 L7

export type MeasureMark = (url: string) => Promise<{ width: number; height: number }>
/** ⚖ S66 R263 — the full pixel decode, run only AFTER the size checks pass (so at most 2048×2048 is ever allocated). */
export type DecodeMark = (file: Blob) => Promise<void>

/** The browser's own decode: the image's natural size. */
const measureInBrowser: MeasureMark = (url) => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
  img.onerror = () => reject(new Error('decode'))
  img.src = url
})

/** ⚖ S66 R260/R263 (proof check 33): Chromium fires <img> load for a truncated file (header only, no image data) and
 *  reports its header size; createImageBitmap rejects it. A throw here = the existing type refusal. Bitmap released at once. */
const decodeInBrowser: DecodeMark = async (file) => {
  if (typeof createImageBitmap === 'undefined') return // an old browser without it: never refuse every logo
  const bitmap = await createImageBitmap(file)
  bitmap.close()
}

function readHead(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file.slice(0, MARK_HEAD_BYTES))
  })
}

type Props = {
  /** Practice (Dev Salon) business: the mark can be picked for the preview. A real business sees L7 only. */
  practice: boolean
  onMark: (e: MarkEvent) => void
  /** Test seam for the pixel size (jsdom decodes nothing). */
  measure?: MeasureMark
  /** Test seam for the full pixel decode (R263). */
  decode?: DecodeMark
}

export function CardMarkBlock({ practice, onMark, measure = measureInBrowser, decode = decodeInBrowser }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLButtonElement>(null)
  const urlRef = useRef<string | null>(null)
  const turn = useRef(0)
  const [name, setName] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<MarkRefusal | null>(null)

  const drop = () => {
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }
  /** R191 (mock :1451 `fx = null`): a refused pick clears the held mark — one state on screen at a time. */
  const refuse = (why: MarkRefusal) => {
    const held = urlRef.current !== null
    drop()
    setName(null)
    setRefusal(why)
    if (held) onMark({ cause: 'refused', why })
  }
  useEffect(() => () => {
    turn.current += 1
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current)
  }, [])

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const mine = ++turn.current
    let head: Uint8Array
    try { head = await readHead(file) } catch { head = new Uint8Array(0) }
    if (mine !== turn.current) return
    const early = checkMarkFile(head, file.size)
    if (early !== null) { refuse(early); return }
    // R193: the URL is typed by the sniffed format, never the file's declared type.
    const typed = new Blob([file], { type: `image/${sniffMarkFormat(head)}` })
    const url = URL.createObjectURL(typed)
    let size: { width: number; height: number } | null = null
    try { size = await measure(url) } catch { size = null }
    if (mine !== turn.current) { URL.revokeObjectURL(url); return }
    const late = size === null ? 'type' : checkMarkSize(size.width, size.height)
    if (late !== null || size === null) { URL.revokeObjectURL(url); refuse(late ?? 'type'); return }
    // R263: only a size that passed reaches the full decode; a newer pick or a flip during it drops this one.
    let decoded = true
    try { await decode(typed) } catch { decoded = false }
    if (mine !== turn.current) { URL.revokeObjectURL(url); return }
    if (!decoded) { URL.revokeObjectURL(url); refuse('type'); return }
    drop()
    urlRef.current = url
    setRefusal(null)
    setName(file.name)
    onMark({ cause: 'picked', mark: { url, width: size.width, height: size.height } })
  }

  const remove = () => {
    turn.current += 1
    drop()
    setName(null)
    setRefusal(null)
    onMark({ cause: 'removed' })
    pickRef.current?.focus()
  }

  return (
    <div
      className="cm-block"
      data-guide-title="ロゴ"
      data-guide={practice
        ? 'お店のロゴ画像を選びます。選ぶと、見本では店名の前にそのロゴが付きます。保存はされず、お客様のアプリにも反映されません。'
        : 'カードの店名の前に付けるロゴを設定する場所です。いまは準備中です。'}
    >
      <h4 className="st-sec-l" id="cmHead">ロゴ</h4>
      {practice ? (
        <>
          <div className="cm-act">
            <button type="button" className="btn" ref={pickRef} onClick={() => inputRef.current?.click()}>ロゴ画像を選ぶ</button>
            <input
              ref={inputRef} className="cm-file" type="file" tabIndex={-1} aria-hidden="true"
              accept="image/png,image/jpeg,image/webp" onChange={onFile} data-testid="card-mark-file"
            />
          </div>
          {refusal !== null && <p className="cm-state cm-state--ng" role="alert">{MARK_REFUSAL[refusal]}</p>}
          {name !== null && (
            <div className="cm-state cm-state--ok">
              <span>このロゴを使えます</span>
              <span className="cm-fn">{name}</span>
              <button type="button" className="btn cm-rm" onClick={remove}>外す</button>
            </div>
          )}
          <p className="st-block-note">{MARK_PRACTICE_LINE}</p>
        </>
      ) : (
        <p className="st-block-note">{MARK_REAL_LINE}</p>
      )}
    </div>
  )
}

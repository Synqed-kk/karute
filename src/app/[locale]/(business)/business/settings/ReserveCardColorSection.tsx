'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { satinVars, normalizeCardColor, RESERVE_CARD_PRESETS } from '@/business/lib/reserve-card-color'
import { businessStrings } from '@/business/i18n'
const copy = businessStrings.reserveCardColor
const endpoint = '/api/business/reserve-card-color'
type Saved = { businessId: string; name: string; color: string | null }
export function ReserveCardColorSection() {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [value, setValue] = useState<string | null>(null)
  const [status, setStatus] = useState(copy.loading)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    const token = ++generation.current
    const abort = new AbortController()
    fetch(endpoint, { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json() as Saved
      if (typeof data.name !== 'string' || !data.businessId || normalizeCardColor(data.color) === undefined) throw new Error('invalid')
      if (generation.current === token) { setSaved(data); setValue(data.color); setStatus('') }
    }).catch(() => { if (generation.current === token) setStatus(copy.loadFailed) })
    return () => { generation.current++; abort.abort() }
  }, [])
  const normalized = normalizeCardColor(value)
  const color = normalized ?? '#285643'
  const dirty = saved !== null && normalized !== saved.color
  const change = (next: string | null) => { setValue(next); setStatus('') }
  async function save() {
    if (!saved || normalized === undefined || !dirty || busy) return
    const token = generation.current
    setBusy(true); setStatus(copy.saving)
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Expected-Business': saved.businessId }, body: JSON.stringify({ color: normalized }) })
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json() as Saved
      if (data.businessId !== saved.businessId || data.color !== normalized) throw new Error('business_changed')
      if (generation.current === token) { setSaved({ ...saved, color: normalized }); setStatus(copy.saved) }
    } catch { if (generation.current === token) setStatus(copy.saveFailed) }
    finally { if (generation.current === token) setBusy(false) }
  }
  return <section className="st-main st-reserve-color" data-guide-title={copy.guideTitle} data-guide={copy.guide}>
    <header><p>{copy.scope}</p><h2>{copy.title}</h2><p>{copy.lead}</p></header>
    <div className="st-reserve-preview" style={satinVars(color) as CSSProperties} aria-label={copy.previewLabel}><strong>{saved?.name || copy.cardName}</strong><span>MEMBER</span></div>
    <p>{copy.description}</p>
    <fieldset disabled={!saved || busy} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>{copy.color}</legend>
      <div className="st-reserve-swatches">{RESERVE_CARD_PRESETS.map((hex,index) => <button type="button" key={hex} onClick={() => change(hex)} aria-pressed={normalized === hex}><i style={{ background: hex }} />{copy.presets[index]}</button>)}</div>
      <div className="st-reserve-custom" data-guide-title={copy.customGuideTitle} data-guide={copy.customGuide}><label>{copy.customLabel}<input aria-label={copy.customGuideTitle} type="color" value={color} onChange={event => change(event.target.value.toUpperCase())} /></label><label>{copy.hexLabel}<input aria-label={copy.hexInput} value={value ?? ''} placeholder="#285643" maxLength={7} onChange={event => change(event.target.value)} aria-invalid={normalized === undefined} /></label></div>
      {normalized === undefined && <p role="alert">{copy.invalidColor}</p>}
      <button type="button" className="btn" onClick={() => change(null)}>{copy.useDefault}</button><p>{copy.persistence}</p>
      <div className="st-reserve-actions"><button className="btn" type="button" disabled={!dirty} onClick={() => change(saved!.color)}>{copy.reset}</button><button className="btn" type="button" disabled={!dirty || normalized === undefined} onClick={save}>{copy.save}</button></div>
    </fieldset><p role="status" aria-live="polite">{status || (dirty ? copy.unsaved : '')}</p>
  </section>
}

'use client'

// 回数券プリセット — owner-managed defaults for the stop-dialog pack picker
// (Liam: prices are an OWNER decision; the toggle decides whether staff may
// deviate). Stored in the org-settings JSON blob — no schema, no migration.
// The picker reads pack_presets for its size/price chips and hides free input
// when staff_can_customize_packs is off.
//
// ticket_packs_enabled is the MASTER switch for the whole 回数券 feature —
// businesses that don't sell session packs (e.g. a gym on monthly membership)
// turn it off here and every pack surface in the app hides. The switch itself
// always renders so the feature can be turned back on.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import {
  upsertOrgSettings,
  type OrgSettings,
  type PackPreset,
} from '@/actions/org-settings'

const MAX_PRESETS = 8

interface PacksSectionProps {
  orgSettings: OrgSettings | null
}

function Toggle({
  checked,
  onClick,
  label,
}: {
  checked: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-muted-foreground/30'
      }`}
    >
      {/* Knob is ANCHORED (left/right), not translated from its static
       *  position — an un-anchored absolute child starts from the button's
       *  centered text position on iOS WebKit, which pushed the knob half
       *  outside the pill (Liam's phone, 2026-07-05). Same pattern as the
       *  PostSessionResolutionDialog switch. */}
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          checked ? 'right-0.5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export function PacksSection({ orgSettings }: PacksSectionProps) {
  const t = useTranslations('settings.packs')
  const [presets, setPresets] = useState<PackPreset[]>(
    orgSettings?.pack_presets ?? [],
  )
  const [staffCustom, setStaffCustom] = useState(
    orgSettings?.staff_can_customize_packs ?? true,
  )
  const [enabled, setEnabled] = useState(
    orgSettings?.ticket_packs_enabled ?? true,
  )
  const [saving, setSaving] = useState(false)

  const setField = (i: number, field: keyof PackPreset, value: number) =>
    setPresets((p) => p.map((row, j) => (j === i ? { ...row, [field]: value } : row)))

  const save = async () => {
    const clean = presets.filter((p) => p.size > 0 && p.unitPrice >= 0)
    setSaving(true)
    try {
      // Off → write ONLY the switch. The preset/staff fields are hidden then,
      // and sending this browser's in-memory copies would silently overwrite a
      // concurrent admin's edits (Greptile, #383).
      const result = await upsertOrgSettings(
        enabled
          ? {
              pack_presets: clean,
              staff_can_customize_packs: staffCustom,
              ticket_packs_enabled: true,
            }
          : { ticket_packs_enabled: false },
      )
      // Soft { error } results (permission denial on web; EVERY failure in
      // the thin shell, whose port maps rejects to { error }) previously fell
      // through to the success toast — a false 保存しました on a pricing
      // surface (design-parity packet 12 §S1 fleet finding).
      if ('error' in result) {
        toast.error(t('saveFailed'))
        return
      }
      if (enabled) setPresets(clean)
      toast.success(t('saved'))
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t('enableTitle')}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('enableHint')}
            </p>
          </div>
          <Toggle
            checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            label={t('enableTitle')}
          />
        </div>
      </section>

      {enabled && (
        <>
          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <h3 className="text-sm font-semibold text-foreground">{t('presetsTitle')}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('presetsHint')}
            </p>

            <div className="mt-4 space-y-2">
              {presets.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  {t('empty')}
                </p>
              )}
              {presets.map((p, i) => (
                <div key={i} className="flex items-center gap-2 tabular-nums">
                  <label className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t('sizeLabel')}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={p.size || ''}
                      onChange={(e) => setField(i, 'size', Number(e.target.value))}
                      className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
                    />
                    <span className="shrink-0 text-[11px] text-muted-foreground">回</span>
                  </label>
                  <label className="flex flex-[1.4] items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t('priceLabel')}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground">¥</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={p.unitPrice || ''}
                      onChange={(e) => setField(i, 'unitPrice', Number(e.target.value))}
                      className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={t('remove')}
                    onClick={() => setPresets((prev) => prev.filter((_, j) => j !== i))}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {presets.length < MAX_PRESETS && (
              <button
                type="button"
                onClick={() => setPresets((p) => [...p, { size: 6, unitPrice: 0 }])}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Plus size={13} />
                {t('addPreset')}
              </button>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t('allowStaffCustom')}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t('allowStaffCustomHint')}
                </p>
              </div>
              <Toggle
                checked={staffCustom}
                onClick={() => setStaffCustom((v) => !v)}
                label={t('allowStaffCustom')}
              />
            </div>
          </section>
        </>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50 md:w-auto md:px-8"
      >
        {saving ? t('saving') : t('save')}
      </button>
    </div>
  )
}

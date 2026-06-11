'use client'

// 回数券プリセット — owner-managed defaults for the stop-dialog pack picker
// (Liam: prices are an OWNER decision; the toggle decides whether staff may
// deviate). Stored in the org-settings JSON blob — no schema, no migration.
// The picker reads pack_presets for its size/price chips and hides free input
// when staff_can_customize_packs is off.

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

export function PacksSection({ orgSettings }: PacksSectionProps) {
  const t = useTranslations('settings.packs')
  const [presets, setPresets] = useState<PackPreset[]>(
    orgSettings?.pack_presets ?? [],
  )
  const [staffCustom, setStaffCustom] = useState(
    orgSettings?.staff_can_customize_packs ?? true,
  )
  const [saving, setSaving] = useState(false)

  const setField = (i: number, field: keyof PackPreset, value: number) =>
    setPresets((p) => p.map((row, j) => (j === i ? { ...row, [field]: value } : row)))

  const save = async () => {
    const clean = presets.filter((p) => p.size > 0 && p.unitPrice >= 0)
    setSaving(true)
    try {
      await upsertOrgSettings({
        pack_presets: clean,
        staff_can_customize_packs: staffCustom,
      })
      setPresets(clean)
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
          <button
            type="button"
            role="switch"
            aria-checked={staffCustom}
            onClick={() => setStaffCustom((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              staffCustom ? 'bg-emerald-500' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                staffCustom ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-foreground py-3 text-sm font-semibold text-background transition-opacity disabled:opacity-50 md:w-auto md:px-8"
      >
        {saving ? t('saving') : t('save')}
      </button>
    </div>
  )
}

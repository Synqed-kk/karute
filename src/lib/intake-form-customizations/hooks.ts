'use client'

// ─────────────────────────────────────────────────────────────
// Intake-form customizations — state layer (localStorage scaffold)
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/lib/intake-form-customizations.ts
// Same useSyncExternalStore + localStorage pattern as
// coaching-consent + subscription. Per-business-type key so
// switching business type doesn't bleed customizations.
//
// PROD SWAP (ANTHONY)
//
// Backend mutations write to a per-org table:
//
//   create table intake_form_customizations (
//     id           uuid pk default gen_random_uuid(),
//     business_id  uuid not null,
//     business_type text not null,
//     custom_fields jsonb not null default '{}',
//     hidden_base   jsonb not null default '{}',
//     updated_at   timestamptz default now(),
//     unique (business_id, business_type)
//   )
//
// RLS:
//   - owners read+write rows where business_id = session
//   - staff read-only (so the intake capture flow can render
//     the live schema)
//
// useIntakeFormCustomizations() returns the merged schema; each
// mutation is one Stripe-style edge-function call.

import { useCallback, useSyncExternalStore } from 'react'

import {
  EMPTY_CUSTOMIZATIONS,
  type IntakeCustomField,
  type IntakeCustomizations,
  type IntakeSectionKey,
} from './types'

const storageKeyFor = (businessType: string) =>
  `synqed-karute-intake-customizations:${businessType}`

// ─── Pub/sub ───────────────────────────────────────────────────

const listeners = new Map<string, Set<() => void>>()

function notify(businessType: string) {
  const fns = listeners.get(businessType)
  if (!fns) return
  for (const fn of fns) fn()
}

function subscribe(businessType: string, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let bucket = listeners.get(businessType)
  if (!bucket) {
    bucket = new Set()
    listeners.set(businessType, bucket)
  }
  bucket.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageKeyFor(businessType) || e.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    bucket?.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// Parse cache per business type
const cache = new Map<
  string,
  { raw: string | null; parsed: IntakeCustomizations }
>()

function read(businessType: string): IntakeCustomizations {
  if (typeof window === 'undefined') return EMPTY_CUSTOMIZATIONS
  const key = storageKeyFor(businessType)
  const raw = window.localStorage.getItem(key)
  const entry = cache.get(businessType)
  if (!raw) {
    cache.set(businessType, { raw: null, parsed: EMPTY_CUSTOMIZATIONS })
    return EMPTY_CUSTOMIZATIONS
  }
  if (entry && entry.raw === raw) return entry.parsed
  try {
    const parsed = JSON.parse(raw) as IntakeCustomizations
    // Defensive: backfill missing sections in case the schema
    // ever grows.
    const merged: IntakeCustomizations = {
      customFields: {
        ...EMPTY_CUSTOMIZATIONS.customFields,
        ...parsed.customFields,
      },
      hiddenBase: { ...EMPTY_CUSTOMIZATIONS.hiddenBase, ...parsed.hiddenBase },
    }
    cache.set(businessType, { raw, parsed: merged })
    return merged
  } catch {
    cache.set(businessType, { raw: null, parsed: EMPTY_CUSTOMIZATIONS })
    return EMPTY_CUSTOMIZATIONS
  }
}

function write(businessType: string, next: IntakeCustomizations) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKeyFor(businessType), JSON.stringify(next))
  notify(businessType)
}

// ─── Reactive read hook ────────────────────────────────────────

export function useIntakeFormCustomizations(businessType: string): {
  customizations: IntakeCustomizations
  addCustomField: (
    section: IntakeSectionKey,
    input: { labelJa: string; labelEn: string },
  ) => void
  removeCustomField: (section: IntakeSectionKey, id: string) => void
  toggleBaseVisibility: (section: IntakeSectionKey, label: string) => void
  clearAll: () => void
} {
  const customizations = useSyncExternalStore(
    (l) => subscribe(businessType, l),
    () => read(businessType),
    () => EMPTY_CUSTOMIZATIONS,
  )

  const addCustomField = useCallback(
    (
      section: IntakeSectionKey,
      input: { labelJa: string; labelEn: string },
    ) => {
      const current = read(businessType)
      const newField: IntakeCustomField = {
        id: `field_${Date.now()}`,
        labelJa: input.labelJa.trim(),
        labelEn: input.labelEn.trim(),
        addedAt: new Date().toISOString(),
      }
      write(businessType, {
        ...current,
        customFields: {
          ...current.customFields,
          [section]: [...current.customFields[section], newField],
        },
      })
    },
    [businessType],
  )

  const removeCustomField = useCallback(
    (section: IntakeSectionKey, id: string) => {
      const current = read(businessType)
      write(businessType, {
        ...current,
        customFields: {
          ...current.customFields,
          [section]: current.customFields[section].filter((f) => f.id !== id),
        },
      })
    },
    [businessType],
  )

  const toggleBaseVisibility = useCallback(
    (section: IntakeSectionKey, label: string) => {
      const current = read(businessType)
      const hidden = current.hiddenBase[section]
      const next = hidden.includes(label)
        ? hidden.filter((l) => l !== label)
        : [...hidden, label]
      write(businessType, {
        ...current,
        hiddenBase: { ...current.hiddenBase, [section]: next },
      })
    },
    [businessType],
  )

  const clearAll = useCallback(() => {
    write(businessType, EMPTY_CUSTOMIZATIONS)
  }, [businessType])

  return {
    customizations,
    addCustomField,
    removeCustomField,
    toggleBaseVisibility,
    clearAll,
  }
}

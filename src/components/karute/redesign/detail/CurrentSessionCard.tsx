'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Target, Pencil } from 'lucide-react'
import type { EntryAuthor } from '@synqed-kk/client'

import { TREATMENT_KIND_PREFIXES } from './treatment-prefixes'
import { EntryEditSheet } from './EntryEditSheet'
import { EntryHistorySheet } from './EntryHistorySheet'

export type SessionCategory =
  | 'treatment'
  | 'concern'
  | 'condition'
  | 'preference'
  | 'lifestyle'
  | 'product'
  | 'next'
  | 'note'

export interface SessionEntry {
  id: string
  category: SessionCategory
  time: string
  body: string
  /** Provenance (edit-layer Wave 2) — undefined on legacy/cached rows, treated
   *  the same as 'AI' (no chip). */
  author?: EntryAuthor
  version?: number
  original_ai_content?: string | null
}

interface CurrentSessionCardProps {
  sessionDate: string
  entries: SessionEntry[]
  tunedFor?: string | null
  /** Optional action rendered in the card header (e.g. AIで再生成 button). */
  headerAction?: ReactNode
  /** Enables the per-row ✎ edit affordance (edit-layer W2 PR-B) when present —
   *  the id the edit sheet writes to. Omitted → entries render inert. */
  karuteRecordId?: string
}

const CATEGORY_TONE: Record<SessionCategory, { bg: string; text: string }> = {
  treatment: { bg: 'rgba(34, 197, 94, 0.18)', text: '#16a34a' },
  concern: { bg: 'rgba(245, 158, 11, 0.18)', text: '#b45309' },
  condition: { bg: 'rgba(139, 92, 246, 0.18)', text: '#7c3aed' },
  // Personal / life context (pets, family, hobbies, routine) — a warm teal, set
  // apart from the clinical 状態 so rapport material reads as rapport.
  lifestyle: { bg: 'rgba(20, 184, 166, 0.18)', text: '#0d9488' },
  product: { bg: 'rgba(59, 130, 246, 0.18)', text: '#2563eb' },
  // Service preferences (pressure, conversation volume, comfort) — previously
  // mis-shelved under 製品; they are how the customer wants to be treated.
  preference: { bg: 'rgba(216, 90, 48, 0.16)', text: '#993c1d' },
  next: { bg: 'rgba(236, 72, 153, 0.18)', text: '#be185d' },
  // Catch-all for facts that fit no other drawer — honest label instead of
  // silently masquerading as a 気になる点.
  note: { bg: 'rgba(136, 135, 128, 0.18)', text: '#5f5e5a' },
}

// Stable session-narrative order — concerns raised → condition read → treatment
// done → products suggested → next visit. Categories absent from the data are
// skipped. This is intentionally NOT the entries' arrival order: staff skim by
// type, not chronology (chronology lives in the transcript).
export const CATEGORY_ORDER: SessionCategory[] = [
  'concern',
  'condition',
  'lifestyle',
  'treatment',
  'preference',
  'product',
  'next',
  'note',
]

// The kind prefixes stripped from treatment titles (「施術：」「トレーニング：」…)
// — the chip already names the kind, so repeating the prefix on every bullet
// reads as noise (Liam, 2026-07-03); strip it and show the kind ONCE as a
// sub-heading. Titles without a known prefix (incl. legacy entries) render
// first, unlabeled. Only exact matches are stripped — body-part titles like
// 「左肩：…」 keep theirs. List lives in treatment-prefixes.ts (imported above,
// shared with the sync test).

function splitTreatmentKinds(items: SessionEntry[]): Array<{
  kind: string | null
  items: Array<SessionEntry & { display: string }>
}> {
  const groups = new Map<string | null, Array<SessionEntry & { display: string }>>()
  for (const e of items) {
    const m = e.body.match(/^([^：:]{1,12})[：:]\s*([\s\S]+)$/)
    const kind =
      m && (TREATMENT_KIND_PREFIXES as readonly string[]).includes(m[1].trim())
        ? m[1].trim()
        : null
    const display = kind && m ? m[2] : e.body
    const arr = groups.get(kind)
    if (arr) arr.push({ ...e, display })
    else groups.set(kind, [{ ...e, display }])
  }
  return [null, ...TREATMENT_KIND_PREFIXES]
    .filter((k) => groups.has(k))
    .map((k) => ({ kind: k, items: groups.get(k)! }))
}

export function CurrentSessionCard({
  sessionDate,
  entries,
  tunedFor,
  headerAction,
  karuteRecordId,
}: CurrentSessionCardProps) {
  const t = useTranslations('karuteDetail')
  const router = useRouter()
  const [editingEntry, setEditingEntry] = useState<SessionEntry | null>(null)
  // History-sheet target (edit-layer W2 history-sheet packet) — the 編集済み
  // chip's tap opens this entry's trail. Separate from editingEntry: the
  // pencil and the chip open different sheets.
  const [historyEntry, setHistoryEntry] = useState<SessionEntry | null>(null)
  // Post-save stale-reopen guard (edit-layer W2 PR-B fleet fix): a save bumps
  // core's version immediately, but this render's props may still carry the
  // pre-save entry until the next fetch lands. An override newer than the
  // prop wins; once props catch up (entry.version >= override.version) it's
  // inert — no timers, no active pruning needed.
  const [overrides, setOverrides] = useState<
    Map<string, { body: string; category: SessionCategory; version: number; author: EntryAuthor }>
  >(new Map())
  if (entries.length === 0) return null

  const withOverride = (entry: SessionEntry): SessionEntry => {
    const o = overrides.get(entry.id)
    return o && o.version > (entry.version ?? -1)
      ? { ...entry, body: o.body, category: o.category, version: o.version, author: o.author }
      : entry
  }
  const mergedEntries = entries.map(withOverride)

  // Legacy/cached rows lack `version` (CAS-required) — refresh instead of
  // opening a sheet with nothing to send.
  const handleEditClick = (entry: SessionEntry) => {
    if (entry.version === undefined) {
      router.refresh()
      return
    }
    // Mutual exclusion (fix round, defensive): never both sheets open.
    setHistoryEntry(null)
    setEditingEntry(entry)
  }

  // Group entries by category so a category renders ONCE (chip + bullet list)
  // instead of repeating the chip + the placeholder created_at time per entry.
  // Built off mergedEntries so both rendering AND a re-click's seed reflect a
  // just-saved override.
  const byCategory = new Map<SessionCategory, SessionEntry[]>()
  for (const e of mergedEntries) {
    const arr = byCategory.get(e.category)
    if (arr) arr.push(e)
    else byCategory.set(e.category, [e])
  }
  const groups = CATEGORY_ORDER.filter((c) => byCategory.has(c))

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {t('currentSession.title')}
        </h3>
        <div className="flex items-center gap-3">
          {headerAction}
          <span className="text-xs tabular-nums text-muted-foreground">
            {sessionDate}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        {groups.map((category) => {
          const tone = CATEGORY_TONE[category]
          const items = byCategory.get(category)!
          return (
            <div key={category} className="flex flex-col gap-2">
              {/* Category header — once per category */}
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-[22px] items-center rounded-md px-2.5 text-[11px] font-semibold"
                  style={{ background: tone.bg, color: tone.text }}
                >
                  {t(`currentSession.categories.${category}`)}
                </span>
                {items.length > 1 && (
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                )}
              </div>
              {/* Entries — clean bullets, color-keyed to the category. The
                  treatment group renders kind sub-headings (施術/セルフケア指導)
                  once instead of a repeated prefix on every line. */}
              {(category === 'treatment'
                ? splitTreatmentKinds(items)
                : [{ kind: null, items: items.map((e) => ({ ...e, display: e.body })) }]
              ).map((sub) => (
                <div key={sub.kind ?? 'plain'} className="flex flex-col gap-1.5">
                  {sub.kind && (
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {sub.kind}
                    </span>
                  )}
                  <ul className="flex flex-col gap-1.5">
                    {sub.items.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-start gap-2.5 text-sm leading-snug text-foreground/90"
                      >
                        <span
                          aria-hidden
                          className="mt-[7px] size-1.5 shrink-0 rounded-full"
                          style={{ background: tone.text }}
                        />
                        <span className="min-w-0">{e.display}</span>
                        {e.author === 'HUMAN_EDITED' &&
                          // Tappable → the history sheet only when a
                          // karuteRecordId is present to read against — inert
                          // otherwise, same rule as the pencil below. Visual
                          // stays identical (quiet), 手書き is untouched (the
                          // ruling covers 編集済み only).
                          (karuteRecordId ? (
                            <button
                              type="button"
                              onClick={() => {
                                // Mutual exclusion (fix round, defensive): never both sheets open.
                                setEditingEntry(null)
                                setHistoryEntry(e)
                              }}
                              className="inline-flex h-[19px] shrink-0 items-center rounded-full border border-border bg-muted px-2 text-[10.5px] font-medium text-muted-foreground"
                            >
                              {t('currentSession.chips.edited')}
                            </button>
                          ) : (
                            <span className="inline-flex h-[19px] shrink-0 items-center rounded-full border border-border bg-muted px-2 text-[10.5px] font-medium text-muted-foreground">
                              {t('currentSession.chips.edited')}
                            </span>
                          ))}
                        {e.author === 'HUMAN_CREATED' && (
                          <span className="inline-flex h-[19px] shrink-0 items-center rounded-full border border-border bg-muted px-2 text-[10.5px] font-medium text-muted-foreground">
                            {t('currentSession.chips.handwritten')}
                          </span>
                        )}
                        {karuteRecordId && (
                          <button
                            type="button"
                            onClick={() => handleEditClick(e)}
                            aria-label={t('entryEdit.editRow')}
                            className="ml-auto shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {tunedFor && (
        <footer className="mt-5 border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/8 px-3 py-1 text-xs text-sky-400">
            <Target size={12} />
            <span className="text-muted-foreground">
              {t('currentSession.tunedFor')}
            </span>
            <span>{tunedFor}</span>
          </span>
        </footer>
      )}

      {karuteRecordId && (
        <>
          <EntryEditSheet
            karuteRecordId={karuteRecordId}
            entry={editingEntry}
            onOpenChange={(open) => {
              if (!open) setEditingEntry(null)
            }}
            onSaved={(saved) =>
              setOverrides((prev) =>
                new Map(prev).set(saved.entryId, {
                  body: saved.body,
                  category: saved.category,
                  version: saved.version,
                  author: saved.author,
                }),
              )
            }
          />
          <EntryHistorySheet
            karuteRecordId={karuteRecordId}
            entry={historyEntry}
            onOpenChange={(open) => {
              if (!open) setHistoryEntry(null)
            }}
          />
        </>
      )}
    </section>
  )
}

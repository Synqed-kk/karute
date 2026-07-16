'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Entry, EntrySchema, ENTRY_CATEGORIES } from '@/types/ai'
import { EntryCard } from './EntryCard'
import { ReviewHeader } from './ReviewHeader'
import { saveKaruteRecord } from '@/actions/karute'
import { saveDraft, clearDraft } from '@/lib/karute/draft'
import { CustomerCombobox, type CustomerOption } from '@/components/karute/CustomerCombobox'
import type { SessionOutcome } from '@/lib/karute/outcome-types'
import { getCustomerConsent, grantCustomerConsent } from '@/actions/customers'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { RecordingConsentDialog } from '@/components/karute/redesign/record/RecordingConsentDialog'

// Form-local extension of the GPT contract (src/types/ai.ts EntrySchema is the
// structured-output shape — never touched). `is_manual` rides the row VALUE so
// a promotion survives useFieldArray remove/append index shifts; confidence is
// widened to allow null on hand-added rows.
const ReviewEntrySchema = EntrySchema.extend({
  confidence_score: z.number().min(0).max(1).nullable(),
  is_manual: z.boolean(),
})

const ReviewFormSchema = z.object({
  summary: z.string().min(1),
  entries: z.array(ReviewEntrySchema),
})

type ReviewFormValues = z.infer<typeof ReviewFormSchema>

interface ReviewScreenProps {
  transcript: string
  entries: Entry[]
  summary: string
  customers: CustomerOption[]
  duration?: number
  appointmentId?: string
  appointmentCustomerId?: string
  /** Outcome chosen at stop (RecordPageView) — applied directly at save, so no
   *  dialog re-opens here. */
  outcome?: SessionOutcome
  /** Server-minted recording_sessions id (synqed-core) — carried to the save so
   *  core's idempotent-save dedupe has something to key on. null/undefined =
   *  today's behavior (no dedupe for that save). */
  recordingSessionId?: string | null
  onSaved: () => void
  /** Bail out without saving — clears the background pipeline + take. */
  onDiscard?: () => void
}

export function ReviewScreen({
  transcript,
  entries,
  summary,
  customers,
  duration,
  appointmentId,
  appointmentCustomerId,
  outcome,
  recordingSessionId,
  onSaved,
  onDiscard,
}: ReviewScreenProps) {
  const t = useTranslations('review')
  const tc = useTranslations('common')
  const [saving, setSaving] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    appointmentCustomerId ?? null
  )
  const [suggestions, setSuggestions] = useState<{ text: string; type: string }[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)

  // Persist a recovery draft the moment the AI result is on screen. The audio is
  // already deleted by now, so this transcript is the ONLY copy — if the WebView
  // backgrounds and is killed, or the tab reloads, the in-memory pipeline is gone
  // and this sessionStorage draft is what RecordPageView restores from. Cleared on
  // successful save. Keyed on transcript so it re-saves if the take changes.
  useEffect(() => {
    if (!transcript) return
    // Fire-and-forget: saveDraft is async now (it stamps the signed-in user id
    // so only that staff member can recover the draft — see lib/karute/draft).
    void saveDraft({
      transcript,
      summary,
      entries: entries.map((e) => ({
        category: e.category,
        content: e.title,
        sourceQuote: e.source_quote,
        confidenceScore: e.confidence_score,
      })),
      duration,
      appointmentId,
      appointmentCustomerId,
      recordingSessionId: recordingSessionId ?? undefined,
    })
  }, [transcript, summary, entries, duration, appointmentId, appointmentCustomerId, recordingSessionId])

  // Fetch AI suggestions based on transcript
  useEffect(() => {
    async function fetchSuggestions() {
      try {
        const res = await getDataPort().apiFetch('/api/ai/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            summary,
            entries: entries.map((e) => ({ category: e.category, title: e.title })),
            locale: typeof window !== 'undefined' ? (document.documentElement.lang || 'en') : 'en',
          }),
        })
        const data = await res.json()
        setSuggestions(data.suggestions ?? [])
      } catch {
        setSuggestions([])
      } finally {
        setSuggestionsLoading(false)
      }
    }
    fetchSuggestions()
  }, [transcript, summary, entries])

  const { control, handleSubmit } = useForm<ReviewFormValues>({
    resolver: zodResolver(ReviewFormSchema),
    // AI-extracted rows start as AI (is_manual: false); EntryCard promotes on edit.
    defaultValues: { summary, entries: entries.map((e) => ({ ...e, is_manual: false })) },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'entries',
  })

  function handleAddEntry() {
    // Hand-added row: human from birth, no AI confidence (null, not a fake 1).
    append({
      category: ENTRY_CATEGORIES[0],
      title: '',
      source_quote: '',
      confidence_score: null,
      is_manual: true,
    })
  }

  // Save-time consent gate: the walk-in flow attaches its customer HERE — the
  // record page's start gate never saw them (and a booked customer's consent
  // could have been revoked since start). Same current-version rule as the
  // start gate; the dialog captures the verbal grant and the save resumes.
  //
  // The pending payload freezes {data, customerId} TOGETHER at the moment Save
  // was pressed — the grant + retry use this snapshot, never a re-read of live
  // form/selection state, so a record can never save to a customer other than
  // the one whose consent was just checked and attested. `saving` stays true
  // for the dialog's whole lifetime (released only on cancel), which keeps the
  // Save button, customer picker, and Discard disabled — closing the
  // double-submit window the review flagged.
  const [pendingConsentSave, setPendingConsentSave] =
    useState<{ data: ReviewFormValues; customerId: string } | null>(null)
  const [consentSubmitting, setConsentSubmitting] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)

  // Outcome is captured upstream (at stop, in RecordPageView) and arrives via
  // the `outcome` prop — applied directly here, no dialog.
  async function handleSave(data: ReviewFormValues) {
    if (saving || pendingConsentSave) return
    if (!appointmentCustomerId && !selectedCustomerId) {
      toast.error(t('selectCustomer'))
      return
    }
    const customerId = appointmentCustomerId ?? selectedCustomerId!

    setSaving(true)
    // Fail closed: an unreadable consent opens the dialog — the grant write is
    // an upsert, so re-granting an unreadable-but-granted consent is harmless.
    let consentCurrent = false
    try {
      const { consent } = await getCustomerConsent(customerId)
      consentCurrent = isConsentCurrent(consent)
    } catch {
      consentCurrent = false
    }
    if (!consentCurrent) {
      // Keep saving=true → background stays locked while the dialog is up.
      setConsentError(null)
      setPendingConsentSave({ data, customerId })
      return
    }
    await performSave(data, customerId)
  }

  async function performSave(data: ReviewFormValues, customerId: string) {
    setSaving(true)
    try {
      const result = await saveKaruteRecord({
        customerId,
        transcript,
        summary: data.summary,
        entries: data.entries.map((e) => ({
          category: e.category as import('@/lib/karute/categories').EntryCategory,
          content: e.title,
          sourceQuote: e.source_quote,
          confidenceScore: e.confidence_score,
          isManual: e.is_manual,
        })),
        duration,
        appointmentId,
        outcome,
        recordingSessionId,
      })

      if (result && 'error' in result) {
        // The server enforces the same gate — if consent got revoked between
        // our pre-check and the save, reopen the dialog (saving stays locked),
        // not a dead-end toast.
        if (result.error === CONSENT_REQUIRED_ERROR) {
          setConsentError(null)
          setPendingConsentSave({ data, customerId })
        } else {
          toast.error(result.error)
          setSaving(false)
        }
      }
      // On success, saveKaruteRecord redirects
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) {
        // Success: saveKaruteRecord redirects by throwing NEXT_REDIRECT. The
        // record is now persisted, so drop the recovery draft, clear the
        // background pipeline (so the top-corner chip doesn't linger after we
        // navigate to the saved karute), then re-throw to let Next route.
        clearDraft()
        onSaved()
        throw err
      }
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  async function handleConsentConfirm() {
    // Use the FROZEN snapshot — never re-derive from live selection/form state.
    if (!pendingConsentSave || consentSubmitting) return
    const { data, customerId } = pendingConsentSave
    setConsentSubmitting(true)
    setConsentError(null)
    // Transport failures (dropped wifi mid-grant) must release the dialog, not
    // wedge it — a bare await here left submitting stuck true with every
    // button inert (adversarial-review blocker).
    let r: Awaited<ReturnType<typeof grantCustomerConsent>>
    try {
      r = await grantCustomerConsent(customerId, { method: 'VERBAL' })
    } catch {
      setConsentSubmitting(false)
      setConsentError(tc('somethingWentWrong'))
      return
    }
    setConsentSubmitting(false)
    if (!r.ok) {
      setConsentError(r.error)
      return
    }
    setPendingConsentSave(null)
    await performSave(data, customerId)
  }

  function handleConsentCancel() {
    if (consentSubmitting) return
    setPendingConsentSave(null)
    setSaving(false)
  }

  const resolvedCustomerId = appointmentCustomerId ?? selectedCustomerId
  const customerName = resolvedCustomerId
    ? (customers.find((c) => c.id === resolvedCustomerId)?.name ?? null)
    : null

  const [checkedSuggestions, setCheckedSuggestions] = useState<Set<number>>(new Set())

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Everything behind the consent dialog goes INERT while it's open —
          the frozen save snapshot means edits typed back here would be
          silently dropped (and Shift+Tab could reach the never-disabled
          editor fields past the dialog's focus). display:contents keeps the
          flex layout byte-identical; inert kills focus/typing/clicks for the
          whole subtree, current and future fields alike. */}
      <div inert={!!pendingConsentSave} className="contents">
      {/* AI Suggestions */}
      {(suggestionsLoading || suggestions.length > 0) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('aiSuggestions')}
            </h3>
          </div>
          <div className="p-4">
          {suggestionsLoading ? (
            <div className="flex gap-3">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {suggestions.map((s, i) => {
                const checked = checkedSuggestions.has(i)
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-2.5 rounded-lg bg-card border border-border/50 px-3 py-2 text-xs text-foreground cursor-pointer transition-colors hover:bg-muted/50 ${checked ? 'opacity-60 line-through' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setCheckedSuggestions((prev) => {
                          const next = new Set(prev)
                          if (next.has(i)) next.delete(i)
                          else next.add(i)
                          return next
                        })
                      }}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                    />
                    <span>{s.text}</span>
                  </label>
                )
              })}
            </div>
          )}
          </div>
        </div>
      )}

      {/* Two-column layout: transcript left, entries right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Left column: Transcript (read-only) */}
        <div className="flex flex-col min-h-0 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('transcript')}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <pre className="text-sm text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">
              {transcript || <span className="text-muted-foreground italic">{t('noTranscript')}</span>}
            </pre>
          </div>
        </div>

        {/* Right column: Summary + Entries */}
        <div className="flex flex-col min-h-0 gap-3 overflow-y-auto">
          {/* Editable AI summary */}
          <ReviewHeader control={control} />

          {/* Entry cards */}
          <div className="space-y-3">
            {fields.map((field, index) => (
              <EntryCard
                key={field.id}
                index={index}
                control={control}
                onRemove={() => remove(index)}
              />
            ))}
          </div>

          {/* Add Entry button */}
          <button
            type="button"
            onClick={handleAddEntry}
            className="flex items-center justify-center gap-2 w-full rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground/70 hover:bg-muted/50 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('addEntry')}
          </button>
        </div>
      </div>

      {/* Save bar — customer selector + save button */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-sm text-muted-foreground shrink-0">{t('customer')}</span>
          {appointmentCustomerId ? (
            <span className="text-sm font-medium text-foreground">{customerName}</span>
          ) : (
            <div className="flex-1 max-w-xs">
              <CustomerCombobox
                customers={customers}
                selectedId={selectedCustomerId}
                onSelect={setSelectedCustomerId}
                onCreateNew={() => {}}
                disabled={saving}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onDiscard && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className="px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {t('discard')}
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit(handleSave)}
            disabled={saving || (!appointmentCustomerId && !selectedCustomerId)}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>
      </div>

      {/* Save-time consent gate (walk-in attach / revoked-consent backstop).
          Name comes from the FROZEN customerId — the script always names the
          customer whose consent is actually being recorded. */}
      {pendingConsentSave && (
        <RecordingConsentDialog
          customerName={
            customers.find((c) => c.id === pendingConsentSave.customerId)?.name ?? ''
          }
          submitting={consentSubmitting}
          error={consentError}
          onCancel={handleConsentCancel}
          onConfirm={handleConsentConfirm}
        />
      )}
    </div>
  )
}

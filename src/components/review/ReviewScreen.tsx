'use client'

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
import { CustomerCombobox, type CustomerOption } from '@/components/karute/CustomerCombobox'

const ReviewFormSchema = z.object({
  summary: z.string().min(1),
  entries: z.array(EntrySchema),
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
  onSaved: () => void
}

export function ReviewScreen({
  transcript,
  entries,
  summary,
  customers,
  duration,
  appointmentId,
  appointmentCustomerId,
  onSaved,
}: ReviewScreenProps) {
  const t = useTranslations('review')
  const tc = useTranslations('common')
  const [saving, setSaving] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    appointmentCustomerId ?? null
  )
  const [suggestions, setSuggestions] = useState<{ text: string; type: string }[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)

  // Fetch AI suggestions based on transcript
  useEffect(() => {
    async function fetchSuggestions() {
      try {
        const res = await fetch('/api/ai/suggestions', {
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
    defaultValues: { summary, entries },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'entries',
  })

  function handleAddEntry() {
    append({
      category: ENTRY_CATEGORIES[0],
      title: '',
      source_quote: '',
      confidence_score: 1,
    })
  }

  async function handleSave(data: ReviewFormValues) {
    if (!appointmentCustomerId && !selectedCustomerId) {
      toast.error(t('selectCustomer'))
      return
    }

    setSaving(true)
    try {
      const customerId = appointmentCustomerId ?? selectedCustomerId!
      const result = await saveKaruteRecord({
        customerId,
        transcript,
        summary: data.summary,
        entries: data.entries.map((e) => ({
          category: e.category as import('@/lib/karute/categories').EntryCategory,
          content: e.title,
          sourceQuote: e.source_quote,
          confidenceScore: e.confidence_score,
        })),
        duration,
        appointmentId,
      })

      if (result && 'error' in result) {
        toast.error(result.error)
        setSaving(false)
      }
      // On success, saveKaruteRecord redirects
    } catch (err) {
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) {
        throw err
      }
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  const customerName = appointmentCustomerId
    ? customers.find((c) => c.id === appointmentCustomerId)?.name
    : null

  const [checkedSuggestions, setCheckedSuggestions] = useState<Set<number>>(new Set())

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
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
  )
}

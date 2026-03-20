'use client'

import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Entry, EntrySchema, ENTRY_CATEGORIES } from '@/types/ai'
import { EntryCard } from './EntryCard'
import { ReviewHeader } from './ReviewHeader'

const ReviewFormSchema = z.object({
  summary: z.string().min(1),
  entries: z.array(EntrySchema),
})

type ReviewFormValues = z.infer<typeof ReviewFormSchema>

interface ReviewScreenProps {
  transcript: string
  entries: Entry[]
  summary: string
  onConfirm: (data: { entries: Entry[]; summary: string; transcript: string }) => void
}

export function ReviewScreen({ transcript, entries, summary, onConfirm }: ReviewScreenProps) {
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

  function handleConfirm(data: ReviewFormValues) {
    onConfirm({ entries: data.entries, summary: data.summary, transcript })
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      {/* Two-column layout: transcript left, entries right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Left column: Transcript (read-only) */}
        <div className="flex flex-col min-h-0 rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Transcript
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <pre className="text-sm text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">
              {transcript || <span className="text-muted-foreground italic">No transcript available.</span>}
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
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground/70 hover:bg-muted/50 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Entry
          </button>
        </div>
      </div>

      {/* Confirm button */}
      <div className="flex justify-end pt-2 border-t border-border">
        <button
          type="button"
          onClick={handleSubmit(handleConfirm)}
          className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Confirm &amp; Save
        </button>
      </div>
    </div>
  )
}

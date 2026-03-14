'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CustomerCombobox } from './CustomerCombobox'
import { QuickCreateCustomer } from './QuickCreateCustomer'
import { loadDraft, clearDraft } from '@/lib/karute/draft'
import { saveKaruteRecord } from '@/actions/karute'
import type { CustomerOption } from './CustomerCombobox'

type SaveKaruteFlowProps = {
  /**
   * Pre-fetched customer list. Pass from a Server Component to avoid
   * a client-side fetch on mount.
   */
  customers: CustomerOption[]
}

type FlowState = 'combobox' | 'quick-create'

/**
 * Save flow: customer selection + save to karute record.
 *
 * Placed on the AI review screen after the user confirms extracted entries.
 * Reads the karute draft from sessionStorage (written by Phase 2).
 *
 * Flow:
 *   1. Load draft from sessionStorage on mount
 *   2. User selects a customer via inline combobox (or creates one)
 *   3. User clicks Save — no confirmation dialog (per user decision)
 *   4. saveKaruteRecord is called; on success it redirects to /karute/[newId]
 *   5. clearDraft() is called to clean up sessionStorage
 */
export function SaveKaruteFlow({ customers }: SaveKaruteFlowProps) {
  const t = useTranslations('karute')
  const [draft, setDraft] = useState<ReturnType<typeof loadDraft>>(null)
  const [hasMounted, setHasMounted] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [flowState, setFlowState] = useState<FlowState>('combobox')
  const [customerList, setCustomerList] = useState<CustomerOption[]>(customers)
  const [isSaving, setIsSaving] = useState(false)

  // Load draft from sessionStorage (client-side only)
  useEffect(() => {
    setDraft(loadDraft())
    setHasMounted(true)
  }, [])

  // Handle customer created inline
  function handleCustomerCreated(newCustomer: CustomerOption) {
    setCustomerList((prev) => [newCustomer, ...prev])
    setSelectedCustomerId(newCustomer.id)
    setFlowState('combobox')
  }

  async function handleSave() {
    if (!draft) return
    if (!selectedCustomerId) {
      toast.error(t('selectCustomerFirst'))
      return
    }

    setIsSaving(true)

    try {
      // Clear draft before the action so it doesn't persist on error re-render
      // The save action will redirect on success; we clear optimistically.
      clearDraft()

      const result = await saveKaruteRecord({
        customerId: selectedCustomerId,
        transcript: draft.transcript,
        summary: draft.summary,
        entries: draft.entries.map((e) => ({
          category: e.category as import('@/lib/karute/categories').EntryCategory,
          content: e.content,
          sourceQuote: e.sourceQuote,
          confidenceScore: e.confidenceScore,
        })),
        duration: draft.duration,
      })

      // If result is returned (not redirected), it's an error
      if (result && 'error' in result) {
        toast.error(result.error)
        // Restore draft on failure so user doesn't lose data
        setIsSaving(false)
      }
      // On success, saveKaruteRecord calls redirect() which throws — React handles it
    } catch (err) {
      // redirect() throws a special Next.js error — let it propagate
      // Any other error is a genuine failure
      if (err instanceof Error && err.message.includes('NEXT_REDIRECT')) {
        throw err
      }
      toast.error(err instanceof Error ? err.message : t('saving'))
      setIsSaving(false)
    }
  }

  // Avoid rendering sessionStorage-dependent content on server
  if (!hasMounted) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-8 w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {t('noDraftFound')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground">
          {t('customer')}
        </label>

        {flowState === 'quick-create' ? (
          <QuickCreateCustomer
            onCreated={handleCustomerCreated}
            onCancel={() => setFlowState('combobox')}
          />
        ) : (
          <CustomerCombobox
            customers={customerList}
            selectedId={selectedCustomerId}
            onSelect={setSelectedCustomerId}
            onCreateNew={() => setFlowState('quick-create')}
            disabled={isSaving}
          />
        )}
      </div>

      {flowState === 'combobox' && (
        <Button
          onClick={handleSave}
          disabled={isSaving || !selectedCustomerId}
          size="default"
          className="self-start"
        >
          {isSaving ? t('saving') : t('saveKarute')}
        </Button>
      )}
    </div>
  )
}

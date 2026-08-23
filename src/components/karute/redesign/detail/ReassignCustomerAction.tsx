'use client'

// F4 — 顧客を変更: re-point a saved karute to another customer (packet
// PACKET-F4-REASSIGN-2026-09-02.md §2g). UI built to the SIGNED-OFF mock
// (mocks/MOCK-F4-REASSIGN-2026-09-02.html, Artifact b5f27b79, Liam 8/23):
// ghost entry point → a store-scoped picker → a confirm panel disclosing
// what stays with the old customer. Imports the server action directly from
// `@/actions/karute` — the SAME cross-platform idiom RegenerateEntriesButton
// already uses (web resolves the real 'use server' action; the thin bundle's
// vite alias resolves the identical name to its facade port twin).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeftRight, Check, Image as ImageIcon, Search, Sparkles, Ticket } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { deriveFamilyInitials } from '@/lib/customers/identity'
import { CUSTOMER_SEARCH_LIMIT, filterCustomers, type CustomerOption } from '@/components/karute/CustomerCombobox'
import { listReassignCustomerOptions, reassignKaruteCustomer } from '@/actions/karute'

// The search box owns the results region (aria-controls) — same idiom as
// RecordCustomerPickerDialog's LIST_ID.
const PICKER_LIST_ID = 'reassign-picker-results'

/** Server `{ error }` strings → the matching translated copy (fix round 2,
 *  item E). The store-scope refusal is a backstop only — the picker roster
 *  is already store-scoped, so a staffer shouldn't be able to reach it — but
 *  the errorStoreScope key shipped in both locales and was dead until this
 *  match. Same string-match idiom errorSameCustomer already used. Anything
 *  unrecognized (including the picker's own "could not verify your store
 *  assignment" refusal, surfaced earlier by openPicker) falls to errorGeneric. */
function reassignErrorMessage(error: string, t: (key: string) => string): string {
  if (error === 'already this customer') return t('errorSameCustomer')
  if (error === 'that customer is outside your assigned store') return t('errorStoreScope')
  return t('errorGeneric')
}

interface ReassignCustomerActionProps {
  karuteId: string
  customerName: string
}

type Preview = {
  toName: string
  burnCount: number
  photoCount: number
}

type Step = 'idle' | 'picking' | 'confirming'

export function ReassignCustomerAction({
  karuteId,
  customerName,
}: ReassignCustomerActionProps) {
  const t = useTranslations('karuteDetail.reassign')
  const tc = useTranslations('common')
  const router = useRouter()

  const [step, setStep] = useState<Step>('idle')
  const [customers, setCustomers] = useState<CustomerOption[] | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep('idle')
    setQuery('')
    setSelectedId(null)
    setPreview(null)
    setError(null)
  }

  async function openPicker() {
    setStep('picking')
    setError(null)
    if (customers === null) {
      setLoadingOptions(true)
      const result = await listReassignCustomerOptions(karuteId)
      setLoadingOptions(false)
      if ('error' in result) {
        setError(t('errorGeneric'))
        setCustomers([])
        return
      }
      setCustomers(result.customers)
    }
  }

  // C-3 idiom (RecordCustomerPickerDialog.tsx:184-198's own lesson, R5-2 /
  // fresh-verify D1): match EVERYTHING, then cap for the screen. Capping
  // INSIDE filterCustomers left no overflow signal — a query matching 12
  // customers silently rendered 8 with no sign more existed, on the one
  // flow whose entire purpose is picking the *right* customer. Empty-query
  // browse mode stays fully uncapped (deliberate, packet §2g) — the cap and
  // its count line apply only while actively searching.
  const trimmed = query.trim()
  const searching = trimmed.length > 0
  const matches = useMemo(
    () => (searching ? filterCustomers(customers ?? [], trimmed, Infinity) : (customers ?? [])),
    [customers, trimmed, searching],
  )
  const visible = useMemo(
    () => (searching ? matches.slice(0, CUSTOMER_SEARCH_LIMIT) : matches),
    [matches, searching],
  )
  const hiddenMatches = searching ? matches.length - visible.length : 0

  async function goToConfirm() {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    const result = await reassignKaruteCustomer(karuteId, selectedId, { confirmed: false })
    setBusy(false)
    if (!('requiresConfirm' in result)) {
      setError('error' in result ? reassignErrorMessage(result.error, t) : t('errorGeneric'))
      return
    }
    setPreview({
      toName: result.toName,
      burnCount: result.burnCount,
      photoCount: result.photoCount,
    })
    setStep('confirming')
  }

  async function confirm() {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    const result = await reassignKaruteCustomer(karuteId, selectedId, { confirmed: true })
    setBusy(false)
    if ('error' in result) {
      setError(reassignErrorMessage(result.error, t))
      return
    }
    reset()
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="inline-flex w-fit items-center gap-1.5 self-start rounded-lg border border-primary/30 bg-card px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/8"
      >
        <ArrowLeftRight size={13} />
        {t('action')}
      </button>

      {/* Picker */}
      <Dialog open={step === 'picking'} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('action')}</DialogTitle>
            <DialogDescription>{t('pickerSubtitle')}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <Search size={15} className="shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={PICKER_LIST_ID}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('pickerSearchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* N5 (fix round 5, house a11y idiom — RecordCustomerPickerDialog's
           *  own id-on-the-wrapper pattern): the search input's aria-controls
           *  must resolve in EVERY state, so the id lives on this always-
           *  rendered wrapper, not on the <ul> that only exists once results
           *  are loaded and non-empty. */}
          <div id={PICKER_LIST_ID}>
            {loadingOptions ? (
              <p className="py-6 text-center text-sm text-muted-foreground">…</p>
            ) : visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('noResults')}</p>
            ) : (
              <>
                <ul
                  role="listbox"
                  aria-label={t('action')}
                  className="flex max-h-[45dvh] flex-col gap-0.5 overflow-y-auto"
                >
                  {visible.map((c) => {
                    const selected = c.id === selectedId
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => setSelectedId(c.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                            selected ? 'border border-primary/30 bg-primary/8' : 'border border-transparent hover:bg-muted/60',
                          )}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/8 text-[11px] font-bold text-primary">
                            {deriveFamilyInitials(c.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium text-foreground">{c.name}</span>
                            {c.furigana && (
                              <span className="block truncate text-[11px] text-muted-foreground">{c.furigana}</span>
                            )}
                          </span>
                          {c.phone && (
                            <span className="shrink-0 text-[11.5px] text-muted-foreground">{c.phone}</span>
                          )}
                          {selected && <Check size={16} className="shrink-0 text-primary" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                {/* R5-2 / fresh-verify D1: the rest of the matches, named
                 *  rather than dropped — outside the listbox, so it never
                 *  counts as an option (mirrors RecordCustomerPickerDialog's
                 *  own hiddenMatches line). */}
                {hiddenMatches > 0 && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    {t('hiddenMatches', { n: hiddenMatches })}
                  </p>
                )}
              </>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button onClick={goToConfirm} disabled={!selectedId || busy}>
              {tc('next')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm */}
      <Dialog open={step === 'confirming'} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('confirmTitle')}</DialogTitle>
          </DialogHeader>

          {preview && (
            <>
              <div className="flex items-center justify-center gap-2.5 py-1">
                <span className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  {customerName}
                </span>
                <ArrowLeftRight size={15} className="shrink-0 text-muted-foreground" />
                <span className="rounded-full border border-primary/30 bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary">
                  {preview.toName}
                </span>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{t('staysTitle')}</p>

                <div className="flex items-start gap-2.5">
                  <Ticket size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-[12.5px] font-medium text-foreground">
                      {t('burnTitle', { n: preview.burnCount })}
                    </p>
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">{t('burnNote')}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <ImageIcon size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-[12.5px] font-medium text-foreground">
                      {t('photoTitle', { n: preview.photoCount })}
                    </p>
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                      {t('photoNote', { name: customerName })}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Sparkles size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className="text-[12.5px] font-medium text-foreground">{t('memoryTitle')}</p>
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">{t('memoryNote')}</p>
                  </div>
                </div>
              </div>

              <p className="text-center text-[11.5px] text-muted-foreground">{t('auditNote')}</p>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={busy}>
              {tc('cancel')}
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {t('confirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

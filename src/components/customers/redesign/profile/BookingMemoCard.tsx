'use client'

// Surfaces the QuickReserve reservation/intake memo (stored full on the synqed
// customer's `notes`) on the karute/customer page, parsed into labeled rows.
//
// WHY THIS EXISTS: La Estro's staff type a semi-structured intake into the QR
// booking note ("▶症状:… ▶ゴール:… ▶セルフ:…"). It's the richest first-touch
// info about a customer, but until now it only appeared — truncated to 100
// chars — on the record screen's brief, and never on the カルテ page. The full
// text is on customer.notes. This is the INTERIM display: deterministic parse,
// read-only, no AI. When Anthony's recording→AI extraction lands, those facts
// get distributed into the structured お客様メモリー boxes and this card can
// retire (or become the raw-source toggle).
//
// EDITABLE (this change): staff now maintain the memo IN Karute — the pencil
// opens an inline textarea over the memo CONTENT (QR prefix stripped for
// editing). On save we RE-PREPEND the original `QR #<id> | ` prefix byte-for-
// byte (it's sync plumbing other code keys QR-origin off — see qr-notes.ts) and
// persist via updateCustomer({ notes }). Safe because QuickReserve writes notes
// only at customer-create; the sync's reconcile never overwrites staff edits.

import { useState } from 'react'
import { ClipboardList, Pencil, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { parseQrMemo, memoContent, QR_NOTES_PREFIX_RE } from '@/lib/sync/qr-notes'
import { updateCustomer } from '@/actions/customers'
import { Button } from '@/components/ui/button'

export function BookingMemoCard({
  customerId,
  memo,
}: {
  customerId: string
  memo: string | null | undefined
}) {
  const t = useTranslations('customers.profile.bookingMemo')
  const tToast = useTranslations('customers.toast')
  const router = useRouter()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // The `QR #<id> | ` prefix (if any) is display/sync plumbing — keep it out of
  // the editable text but preserve it byte-for-byte to re-prepend on save.
  const prefixMatch = memo?.match(QR_NOTES_PREFIX_RE)
  const prefix = prefixMatch ? prefixMatch[0] : ''
  // The HUMAN memo (bare `QR #<id>` plumbing → null via qr-notes' QR_BARE_TAG_RE).
  const content = memoContent(memo) ?? ''
  const [draft, setDraft] = useState(content)

  // No human memo AND not editing → keep the card hidden. Keyed on memoContent,
  // NOT raw memo, so a note that's ONLY a bare QR back-reference (e.g. after a
  // staff clear leaves `QR #42 |`) stays hidden instead of surfacing the raw
  // plumbing as text. In edit mode we always render so staff can author a memo.
  if (!editing && !content) return null

  const rows = memo ? parseQrMemo(memo) : null

  function openEditor() {
    setDraft(memoContent(memo) ?? '')
    setEditing(true)
  }

  async function handleSave() {
    const trimmed = draft.trim()
    // Re-prepend the original QR back-reference; empty content clears the memo
    // (updateCustomer's partial path accepts an empty string → null-ish notes).
    const nextNotes = trimmed ? `${prefix}${trimmed}` : prefix.trim()
    setSaving(true)
    try {
      const res = await updateCustomer(customerId, { notes: nextNotes })
      if (res.success) {
        setEditing(false)
        // updateCustomer revalidates /customers/[id]; refresh pulls the new
        // structured rows through without a client refetch.
        router.refresh()
      } else {
        toast.error(tToast('error'))
      }
    } catch {
      toast.error(tToast('error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 shrink-0 text-sky-500" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">予約・問診メモ</h3>
        <span className="rounded-full border border-border bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
          QuickReserve
        </span>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            aria-label={t('edit')}
            className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil size={13} aria-hidden />
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            aria-label={t('edit')}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            rows={7}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('hint')}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              <X className="size-3.5" aria-hidden />
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              ) : (
                <Save className="size-3.5" aria-hidden />
              )}
              {t('save')}
            </Button>
          </div>
        </div>
      ) : rows ? (
        <dl className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[5.5rem_1fr] gap-3 text-[13px] leading-relaxed">
              <dt className="shrink-0 text-muted-foreground">{r.label || '—'}</dt>
              <dd className="whitespace-pre-wrap text-foreground/90">{r.value || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        // Unstructured memo → render the human content only (memoContent strips
        // any `QR #<id> | ` prefix), never the raw sync plumbing. `content` is
        // guaranteed non-empty here in display mode (the guard above returned
        // null otherwise); in edit mode this branch isn't reached.
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{content}</p>
      )}

      {!editing && (
        <p className="mt-3 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          予約システムの問診メモです。録音からAIが自動でメモリーへ整理するまでの暫定表示。
        </p>
      )}
    </section>
  )
}

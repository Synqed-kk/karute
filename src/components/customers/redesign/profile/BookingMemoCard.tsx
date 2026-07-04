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

import { ClipboardList } from 'lucide-react'
import { parseQrMemo } from '@/lib/sync/qr-notes'

export function BookingMemoCard({ memo }: { memo: string | null | undefined }) {
  if (!memo || !memo.trim()) return null
  const rows = parseQrMemo(memo)

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 shrink-0 text-sky-500" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">予約・問診メモ</h3>
        <span className="rounded-full border border-border bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
          QuickReserve
        </span>
      </div>

      {rows ? (
        <dl className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[5.5rem_1fr] gap-3 text-[13px] leading-relaxed">
              <dt className="shrink-0 text-muted-foreground">{r.label || '—'}</dt>
              <dd className="whitespace-pre-wrap text-foreground/90">{r.value || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{memo}</p>
      )}

      <p className="mt-3 border-t border-border/50 pt-2 text-[11px] leading-relaxed text-muted-foreground">
        予約システムの問診メモです。録音からAIが自動でメモリーへ整理するまでの暫定表示。
      </p>
    </section>
  )
}

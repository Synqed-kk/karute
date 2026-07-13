'use client'

import { useState } from 'react'
import { AlertCircle, Clock, Mic, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useRouter } from '@/i18n/navigation'
import { revokeCustomerConsent } from '@/actions/customers'
import { ComingSoonChip } from '../ComingSoonChip'

interface PrivacyTabContentProps {
  customerId: string
  customerName: string
  /** "Currently granted" — same isConsentCurrent truth the recording gate
   *  uses. Revoke row only renders when true. */
  consentGranted: boolean
  consentGrantedAtLabel: string | null
}

export function PrivacyTabContent({
  customerId,
  customerName,
  consentGranted,
  consentGrantedAtLabel,
}: PrivacyTabContentProps) {
  const t = useTranslations('customers.privacy')
  const router = useRouter()
  const pendingTitle = t('wiringPending')
  const [revoking, setRevoking] = useState(false)

  async function handleRevoke() {
    if (!window.confirm(t('consentRevokeConfirm'))) return
    setRevoking(true)
    try {
      const res = await revokeCustomerConsent(customerId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(t('consentRevokeSuccess'))
      router.refresh()
    } finally {
      setRevoking(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <AlertCircle size={16} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t('title')}
            </h3>
            <ComingSoonChip />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('subtitle', { name: customerName })}
          </p>
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        {consentGranted && (
          <li className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-700 dark:text-red-300">
              <Mic size={16} />
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <div className="text-sm font-semibold text-foreground">
                {t('consentRevokeTitle')}
              </div>
              <p className="text-xs text-muted-foreground">
                {consentGrantedAtLabel
                  ? t('consentRevokeBody', { date: consentGrantedAtLabel })
                  : t('consentRevokeBodyNoDate')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRevoke}
              disabled={revoking}
              className="inline-flex h-8 shrink-0 items-center rounded-full bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {t('consentRevokeCta')}
            </button>
          </li>
        )}
        <PrivacyAction
          tone="blue"
          icon={<Clock size={16} />}
          title={t('accessHistoryTitle')}
          body={t('accessHistoryBody', { name: customerName })}
          cta={t('accessHistoryCta')}
          ctaTone="blue"
          pendingTitle={pendingTitle}
        />
        <PrivacyAction
          tone="neutral"
          icon={<Upload size={16} />}
          title={t('exportTitle')}
          body={t('exportBody')}
          cta={t('exportCta')}
          ctaTone="ghost"
          pendingTitle={pendingTitle}
        />
        <PrivacyAction
          tone="danger"
          icon={<AlertCircle size={16} />}
          title={t('deleteTitle')}
          body={t('deleteBody')}
          cta={t('deleteCta')}
          ctaTone="danger"
          pendingTitle={pendingTitle}
        />
      </ul>

      <footer className="mt-4 flex items-start gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[11px] text-muted-foreground">
        <AlertCircle size={12} className="mt-0.5 shrink-0" />
        <span>{t('footer')}</span>
      </footer>
    </section>
  )
}

function PrivacyAction({
  tone,
  icon,
  title,
  body,
  cta,
  ctaTone,
  pendingTitle,
}: {
  tone: 'blue' | 'neutral' | 'danger'
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  ctaTone: 'blue' | 'ghost' | 'danger'
  pendingTitle: string
}) {
  const toneClasses =
    tone === 'blue'
      ? 'border-sky-500/30 bg-sky-500/5'
      : tone === 'danger'
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-border bg-background/40'
  const iconBg =
    tone === 'blue'
      ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
      : tone === 'danger'
        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
        : 'bg-muted text-muted-foreground'
  const btnClasses =
    ctaTone === 'blue'
      ? 'bg-sky-500 text-white hover:bg-sky-600'
      : ctaTone === 'danger'
        ? 'bg-red-500 text-white hover:bg-red-600'
        : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
  return (
    <li className={`flex items-start gap-3 rounded-xl border p-3 ${toneClasses}`}>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
      >
        {icon}
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <button
        type="button"
        disabled
        className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold opacity-60 ${btnClasses}`}
        title={pendingTitle}
      >
        {cta}
      </button>
    </li>
  )
}

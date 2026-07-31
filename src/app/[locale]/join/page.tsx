import { getTranslations, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'

import { getInviteByToken } from '@/actions/invites'
import { JoinForm } from '@/components/join/JoinForm'
import { PAGE_PICKS, pickMessages } from '@/i18n/client-messages'

// Staff-invite join page. Lives OUTSIDE the (app) route group so the auth guard
// in (app)/layout.tsx doesn't redirect an unauthenticated invitee to /login.
// Gated by NEXT_PUBLIC_FEATURE_STAFF_INVITES (off until the tenant-isolation
// migration 20260603000000 is applied on prod).
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { locale } = await params
  const { token } = await searchParams
  const t = await getTranslations('invite')

  const enabled = process.env.NEXT_PUBLIC_FEATURE_STAFF_INVITES === 'true'
  const result = enabled && token ? await getInviteByToken(token) : null

  return (
    <NextIntlClientProvider
      messages={pickMessages(await getMessages(), PAGE_PICKS.join)}
    >
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8 space-y-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/karute_logo.png" alt="Karute" className="h-12 object-contain dark:invert" />

        {!enabled ? (
          <Message title={t('joinInvalidTitle')} body={t('disabled')} />
        ) : !token || !result ? (
          <Message title={t('joinInvalidTitle')} body={t('reason_missing')} />
        ) : !result.valid ? (
          <Message title={t('joinInvalidTitle')} body={t(`reason_${result.reason}`)} />
        ) : (
          <>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {t('joinTitle', { salon: result.salonName })}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('joinSubtitle')}</p>
            </div>
            <JoinForm token={token} email={result.email} locale={locale} />
          </>
        )}
      </div>
    </div>
    </NextIntlClientProvider>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{body}</p>
    </div>
  )
}

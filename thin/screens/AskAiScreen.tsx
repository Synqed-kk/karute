// Ask-AI screen in the thin bundle (packet 04, inventory #1). Fetches the
// coarse screen DTO through the DataPort, then derives the business profile +
// prompt templates with the SAME pure lookup module the web page uses
// (src/lib/welcome/business-types.ts) — the DTO carries only the key.

import { useTranslations } from 'next-intl'
import { AIAssistantView } from '@/components/ai/redesign/AIAssistantView'
import {
  getBusinessProfile,
  getConsultationQuestions,
} from '@/lib/welcome/business-types'
import { AskAiScreenDTO, type AskAiScreenDTOType } from '@/lib/app-api/ask-ai-dto'
import type { DataScopeItem } from '@/components/ai/redesign/AIPageHeader'
import { getThinLocale } from '../locale'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): AskAiScreenDTOType => AskAiScreenDTO.parse(raw)

export function AskAiScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/ask-ai', parse)
  // Same i18n keys the web page uses (ask-ai/page.tsx t('scopeKarute') etc.)
  // — the chips previously hardcoded English labels, thin-only.
  const t = useTranslations('askAi')
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => {
        // Page parity (app/[locale]/(app)/ask-ai/page.tsx): '' and null both
        // mean "no business type" → generic profile, default prompts.
        const businessType = dto.businessType
        // Runtime shell locale (thin/locale.ts) — pass it through so the AI
        // profile label + prompt cards resolve their locale twins instead of
        // silently defaulting to the functions' English default.
        const locale = getThinLocale()
        const profile = businessType ? getBusinessProfile(businessType, locale) : null
        const prompts = getConsultationQuestions(businessType ?? null, locale).slice(0, 3)
        const scope: DataScopeItem[] = [
          { label: t('scopeKarute'), count: dto.scope.karute },
          { label: t('scopeCustomers'), count: dto.scope.customers },
          { label: t('scopeBookings'), count: dto.scope.bookings },
          { label: t('scopeRecordings'), count: dto.scope.recordings },
        ]
        return (
          <AIAssistantView
            scope={scope}
            profile={profile}
            prompts={prompts}
            // Today-signals need a live signals DTO field (web page derives them
            // server-side); the thin screen ships without them until the facade
            // exposes one — empty renders the header without signal chips.
            signals={[]}
            locale={locale}
          />
        )
      }}
    </ScreenStates>
  )
}

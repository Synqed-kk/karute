// Ask-AI screen in the thin bundle (packet 04, inventory #1). Fetches the
// coarse screen DTO through the DataPort, then derives the business profile +
// prompt templates with the SAME pure lookup module the web page uses
// (src/lib/welcome/business-types.ts) — the DTO carries only the key.

import { AIAssistantView } from '@/components/ai/redesign/AIAssistantView'
import {
  getBusinessProfile,
  getConsultationQuestions,
} from '@/lib/welcome/business-types'
import { AskAiScreenDTO, type AskAiScreenDTOType } from '@/lib/app-api/ask-ai-dto'
import type { DataScopeItem } from '@/components/ai/redesign/AIPageHeader'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): AskAiScreenDTOType => AskAiScreenDTO.parse(raw)

export function AskAiScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/ask-ai', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => {
        // Page parity (app/[locale]/(app)/ask-ai/page.tsx): '' and null both
        // mean "no business type" → generic profile, default prompts.
        const businessType = dto.businessType
        const profile = businessType ? getBusinessProfile(businessType) : null
        const prompts = getConsultationQuestions(businessType ?? null).slice(0, 3)
        const scope: DataScopeItem[] = [
          { label: 'Karute', count: dto.scope.karute },
          { label: 'Customers', count: dto.scope.customers },
          { label: 'Bookings', count: dto.scope.bookings },
          { label: 'Recordings', count: dto.scope.recordings },
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
            locale="ja"
          />
        )
      }}
    </ScreenStates>
  )
}

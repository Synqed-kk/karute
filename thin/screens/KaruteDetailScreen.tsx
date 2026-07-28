// Session-detail screen in the thin bundle (packet 07 §Build 5, inventory #5).
// Fetches the screen-shaped DTO through the DataPort on mount and renders the
// existing KaruteDetailView subtree AS-IS. The two Suspense-streamed AI cards
// become small client components that fetch Decision 1's resource-scoped GETs on
// mount (the same preview components as BOTH the loading and the null state —
// exact web fallback parity). photos come folded in the DTO → PhotoRecordsCard.
//
// SESSION-PROVIDER TRACE (§Page recon): KaruteDetailView → KaruteCoachingPanel
// calls useSession() UNCONDITIONALLY (before its owner role-gate), and the thin
// AppRoot does NOT mount a SessionProvider (web mounts it in the (app) layout).
// So the view is wrapped in a SessionProvider seeded from the DTO's viewerRole —
// without it the screen throws at mount; with it the owner-hides-the-panel privacy
// gate still holds.

import { useEffect, useState } from 'react'
import { getDataPort } from '@/lib/ports/data-port'
import { SessionProvider } from '@/providers/session-provider'
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import { PhotoRecordsCard } from '@/components/karute/redesign/detail/PhotoRecordsCard'
import { AIBodyPredictionCard, type BodyPrediction } from '@/components/karute/redesign/detail/AIBodyPredictionCard'
import { AISuggestedMessageCard, type SuggestedMessage } from '@/components/karute/redesign/detail/AISuggestedMessageCard'
import {
  AIBodyPredictionPreview,
  AIOutreachPreview,
} from '@/components/customers/redesign/profile/UpcomingAiFeatures'
import {
  KaruteDetailScreenDTO,
  type KaruteDetailScreenDTOType,
} from '@/lib/app-api/karute-detail-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): KaruteDetailScreenDTOType =>
  KaruteDetailScreenDTO.parse(raw)

/** Fetch a Decision-1 AI card on mount. The preview is BOTH the loading state and
 *  the null/failure state (web fallback parity — the card "can never look worse").
 *  A non-2xx or a null payload keeps the preview; never surfaces an error. */
function useAiSlot<T>(path: string | null, pick: (body: unknown) => T | null): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    getDataPort()
      .apiFetch(path)
      .then(async (res) => (res.ok ? pick(await res.json().catch(() => null)) : null))
      .then((v) => {
        if (alive && v) setValue(v)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick is a stable module fn; path drives the fetch
  }, [path])
  return value
}

const enc = encodeURIComponent

function BodyPredictionSlot({ customerId, locale }: { customerId: string | null; locale: string }) {
  const prediction = useAiSlot<BodyPrediction>(
    customerId ? `/api/app/v1/customers/${enc(customerId)}/ai/body-prediction?locale=${locale}` : null,
    (b) => (b as { prediction?: BodyPrediction | null } | null)?.prediction ?? null,
  )
  if (!prediction) return <AIBodyPredictionPreview />
  return <AIBodyPredictionCard prediction={prediction} />
}

function SuggestedMessageSlot({
  karuteId,
  customerId,
  customerName,
  locale,
}: {
  karuteId: string
  customerId: string | null
  customerName: string
  locale: string
}) {
  const draft = useAiSlot<SuggestedMessage>(
    `/api/app/v1/karute/${enc(karuteId)}/ai/suggested-message?locale=${locale}`,
    (b) => (b as { draft?: SuggestedMessage | null } | null)?.draft ?? null,
  )
  if (!draft) return <AIOutreachPreview />
  return <AISuggestedMessageCard customerName={customerName} customerId={customerId} draft={draft} />
}

export function KaruteDetailScreen({ id }: { id: string }) {
  const { state, retry } = useScreenDto(
    `/api/app/v1/screens/karute/${enc(id)}`,
    parse,
  )
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <SessionProvider
          data={{
            userId: '',
            staffList: [],
            // Only the display role is read (KaruteCoachingPanel's owner gate).
            activeStaff: { id: '', name: '', displayRole: dto.viewerRole },
            activeStaffId: null,
            locale: 'ja',
            orgName: null,
          }}
        >
          <KaruteDetailView
            karuteId={dto.karuteId}
            customerId={dto.customerId}
            outcome={dto.outcome}
            header={dto.header}
            sessionDateLong={dto.sessionDateLong}
            sessionDateIso={dto.sessionDateIso}
            entries={dto.entries}
            summaryBullets={dto.summaryBullets}
            summaryRaw={dto.summaryRaw ?? null}
            summaryEdited={dto.summaryEdited ?? false}
            transcript={dto.transcript}
            consentOnFile={dto.consentOnFile}
            transcriptDurationLabel={dto.transcriptDurationLabel}
            transcriptRestricted={dto.transcriptRestricted}
            memory={null}
            photosSlot={<PhotoRecordsCard photos={dto.photos} />}
            bodyPredictionSlot={<BodyPredictionSlot customerId={dto.customerId} locale="ja" />}
            suggestedMessageSlot={
              <SuggestedMessageSlot
                karuteId={dto.karuteId}
                customerId={dto.customerId}
                customerName={dto.header.customerName}
                locale="ja"
              />
            }
          />
        </SessionProvider>
      )}
    </ScreenStates>
  )
}

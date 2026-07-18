// Record-home screen in the thin bundle (packet 08 §Build 6, inventory #6 — the
// recording flow, the largest subtree). Fetches the screen-shaped DTO through the
// DataPort and renders RecordPageView AS-IS. The streamed AI pre-session brief
// becomes a small client fetch of the Decision-1 GET on mount, handed to
// RecordPageView as `aiBriefPromise` — the mechanical `brief` prop is BOTH the
// loading and the null state (exact web fallback parity; the card upgrades in
// place when the promise resolves).
//
// TRACE (§Build 6): (b) grep-verified there is NO useSession() consumer in the
// record subtree, so — unlike the session-detail screen — NO SessionProvider seed
// is needed (viewerRole rides the DTO for parity/future use). (c) @/i18n/navigation
// resolves through the thin nav port. (d) getUserMedia + noiseSuppression run on
// WKWebView; mic capture is device-only (packet-09 checklist). (e) the capture
// pipeline's upload+transcribe legs run through the recording port (Decision 2).

import { useMemo } from 'react'
import { getDataPort } from '@/lib/ports/data-port'
import { useSearchParams } from '../ports/nav.vite'
import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'
import type { RecordTargetBooking } from '@/components/karute/redesign/record/RecordingTargetCard'
import type { PreSessionBriefResult } from '@/lib/karute/ai-brief'
import { RecordScreenDTO, type RecordScreenDTOType } from '@/lib/app-api/record-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): RecordScreenDTOType => RecordScreenDTO.parse(raw)
const enc = encodeURIComponent

function RecordScreenInner({ dto }: { dto: RecordScreenDTOType }) {
  // The AI brief promise (Decision 1) — created ONCE per target so React's use()
  // gets a stable promise. Resolves to null on no-target / non-2xx / failure →
  // the card stays on the mechanical `brief` (web fallback parity).
  const aiBriefPromise = useMemo<Promise<PreSessionBriefResult | null>>(() => {
    const customerId = dto.nextAppointment?.customerId
    if (!customerId) return Promise.resolve(null)
    const appt = dto.nextAppointment?.id
      ? `&appointmentId=${enc(dto.nextAppointment.id)}`
      : ''
    return getDataPort()
      .apiFetch(
        `/api/app/v1/customers/${enc(customerId)}/ai/pre-session-brief?locale=${dto.locale}${appt}`,
      )
      .then(async (res) =>
        res.ok
          ? ((await res.json().catch(() => null)) as { brief?: PreSessionBriefResult | null } | null)
              ?.brief ?? null
          : null,
      )
      .catch(() => null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id/customerId drive it
  }, [dto.nextAppointment?.customerId, dto.nextAppointment?.id, dto.locale])

  return (
    <RecordPageView
      customers={dto.customers}
      locale={dto.locale}
      nextAppointment={dto.nextAppointment}
      // Server-derived, DTO-validated color keys; the view's strict union is a
      // superset of the string the schema accepts.
      nearbyBookings={dto.nearbyBookings as RecordTargetBooking[]}
      brief={dto.brief}
      aiBriefPromise={aiBriefPromise}
      recentRecordings={dto.recentRecordings}
      consentDate={dto.consentDate}
      visitSegment={dto.visitSegment}
      visitRhythm={dto.visitRhythm}
      targetHasTicketPack={dto.targetHasTicketPack}
      targetPack={dto.targetPack}
      packPresets={dto.packPresets}
      staffCanCustomizePacks={dto.staffCanCustomizePacks}
      previousPack={dto.previousPack}
      ticketsEnabled={dto.ticketsEnabled}
      noiseSuppression={dto.noiseSuppression}
      currentStaffName={dto.currentStaffName}
    />
  )
}

export function RecordScreen() {
  // Pass the incoming query (appointmentId/customerId) through to the screen GET
  // so a booking tapped on 予約 / a 録音 from a customer card resolves the same
  // recording target the web page does.
  const search = useSearchParams()
  const qs: string[] = []
  const appointmentId = search.get('appointmentId')
  const customerId = search.get('customerId')
  if (appointmentId) qs.push(`appointmentId=${enc(appointmentId)}`)
  if (customerId) qs.push(`customerId=${enc(customerId)}`)
  qs.push('locale=ja')
  const { state, retry } = useScreenDto(`/api/app/v1/screens/record?${qs.join('&')}`, parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => <RecordScreenInner dto={dto} />}
    </ScreenStates>
  )
}

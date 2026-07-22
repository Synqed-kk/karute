// /welcome (onboarding wizard) screen in the thin bundle (design-parity
// packet 21). Fetches the screen-shaped DTO through the DataPort and renders
// the REAL WelcomeWizard — the same leaf component the web page renders. The
// DTO's 3 fields rename onto the wizard's `initial*` props (same class of
// passthrough as DashboardScreen, not a 1:1 spread like ProfileScreen's —
// still no per-field VALUE mapping beyond the rename, so no separate Inner
// export is needed for test coverage: the wired-mount test drives this
// component directly through the DataPort seam).
//
// Language switcher shell-hide (WebOnly, ruling ② precedent) and the
// completeOnboarding write are both handled entirely inside WelcomeWizard —
// nothing extra to wire here.

import { WelcomeWizard } from '@/components/welcome/WelcomeWizard'
import { WelcomeScreenDTO, type WelcomeScreenDTOType } from '@/lib/app-api/welcome-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): WelcomeScreenDTOType => WelcomeScreenDTO.parse(raw)

export function WelcomeScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/welcome', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => (
        <WelcomeWizard
          initialBusinessName={dto.salon_name}
          initialBusinessType={dto.business_type}
          initialDisclosureMode={dto.recording_disclosure_mode}
        />
      )}
    </ScreenStates>
  )
}

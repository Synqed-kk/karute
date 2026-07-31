// プロフィール (profile) screen in the thin bundle (design-parity packet 12
// §B-2). Fetches the screen-shaped DTO through the DataPort and renders the
// REAL ProfilePageView — the same leaf component the web page renders.
// The DTO shape mirrors ProfilePageProfile field-for-field (no per-field
// passthrough mapping like DashboardScreen's 20-field prop list), so the
// parsed dto IS the `profile` prop directly.
//
// Sign-out (ProfilePageView:84-101) and the language switcher's shell-hide
// (WebOnly, ProfilePageView's Preferences section) are handled entirely
// inside ProfilePageView — nothing extra to wire here.

import { ProfilePageView } from '@/components/profile/redesign/ProfilePageView'
import { ProfileScreenDTO, type ProfileScreenDTOType } from '@/lib/app-api/profile-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): ProfileScreenDTOType => ProfileScreenDTO.parse(raw)

export function ProfileScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/profile', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => <ProfilePageView profile={dto} />}
    </ScreenStates>
  )
}

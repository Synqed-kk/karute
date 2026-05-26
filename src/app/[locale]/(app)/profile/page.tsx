// ─────────────────────────────────────────────────────────────
// /[locale]/profile — server entry
// ─────────────────────────────────────────────────────────────
// Resolves the signed-in user's staff row + email + role server-
// side and passes them down to ProfilePageView. The page itself
// is Layer 1 (staff-private) — RLS on the staff query already
// scopes by auth.uid() via getActiveStaffId().
//
// Spike source: src/app/[locale]/(app)/profile/page.tsx (the
// view portion lives in components/profile/redesign/...). The
// spike fetched profile data client-side via useCurrentProfile();
// karute reads from the same cached server helpers already used
// by the (app)/layout, so there's no extra round-trip.

import { createClient } from '@/lib/supabase/server'
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'
import { getOrgSettings } from '@/actions/org-settings'
import {
  ProfilePageView,
  type ProfilePageProfile,
} from '@/components/profile/redesign/ProfilePageView'

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default async function ProfilePage() {
  const supabase = await createClient()
  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    orgSettings,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    getOrgSettings(),
  ])

  const activeStaff = activeStaffId
    ? staffList.find((s) => s.id === activeStaffId) ?? null
    : null

  const isOwner = (activeStaff?.display_role ?? '').toLowerCase() === 'owner'
  const name = activeStaff?.full_name ?? user?.email?.split('@')[0] ?? 'Unknown'
  const orgName = orgSettings?.salon_name ?? '—'

  const profile: ProfilePageProfile = {
    name,
    initials: deriveInitials(name),
    email: user?.email ?? '—',
    role: isOwner ? 'owner' : 'staff',
    roleLabel: isOwner
      ? { ja: 'オーナー', en: 'Owner' }
      : { ja: 'スタッフ', en: 'Stylist' },
    storeName: { ja: orgName, en: orgName },
  }

  return <ProfilePageView profile={profile} />
}

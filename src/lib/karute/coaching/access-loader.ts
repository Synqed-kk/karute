// ─────────────────────────────────────────────────────────────────────────
// Coaching access — server-side loader
// ─────────────────────────────────────────────────────────────────────────
// Reads the live tier + unlimited override (entitlements) and the owner toggle
// (org_settings.coaching_enabled, false until Anthony adds the column) and folds
// them through the pure coachingAccessFor decision.
//
// WIRING (for Anthony — where this must be called):
//   1. RENDER GATE — the coaching page (server) calls loadCoachingAccess(businessId)
//      and, when !canUse, renders the gated state instead of the dashboard:
//        reason 'not_entitled' → owner sees an upgrade prompt (link to Subscription);
//                                staff see "not available on this plan".
//        reason 'disabled'     → owner sees "turn it on in Settings"; staff see
//                                "your owner hasn't enabled coaching yet".
//   2. GENERATOR GATE — EVERY coaching generator (the prompts in ./prompts) checks
//      canUse before it fires. This is what makes "off = no AI cost", not just a
//      hidden UI. Do not rely on the render gate alone.
//   3. SETTINGS TOGGLE — CoachingSection's master switch persists coaching_enabled
//      via upsertOrgSettings; the switch itself should be disabled (with an upgrade
//      hint) when !entitled, so a free-tier owner can't flip on something they can't use.
//
// Graceful: pre-migration or core-unavailable → coaching stays dark (entitlement
// degrades to 'free', coaching_enabled reads false), so nothing throws before the
// backend lands. Liam's account is entitled via the existing unlimited override.

import { loadEntitlement } from '@/lib/entitlements'
import { getOrgSettings } from '@/actions/org-settings'

import { coachingAccessFor, type CoachingAccess } from './access'

export async function loadCoachingAccess(businessId: string): Promise<CoachingAccess> {
  try {
    const [ent, settings] = await Promise.all([loadEntitlement(businessId), getOrgSettings()])
    return coachingAccessFor({
      tier: ent.tier,
      isUnlimited: ent.isUnlimited,
      enabled: settings?.coaching_enabled ?? false,
    })
  } catch {
    // Fail CLOSED on ANY error (audit finding: the Promise.all could reject and the
    // 'nothing throws' promise wasn't actually guaranteed). Coaching off > coaching
    // accidentally on for someone who shouldn't have it.
    return { entitled: false, enabled: false, canUse: false, reason: 'not_entitled' }
  }
}

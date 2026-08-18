'use client'

// SPIKE-ALIGNED REWRITE — was a basic outlined list with inline Edit /
// PIN / Delete buttons. Liam asked to match the design spike's richer
// staff-management card design:
//   - Header row with "スタッフメンバー" + count + UserPlus icon button + "追加"
//   - Each staff row in a unified rounded card:
//       avatar circle (initials) · name + role chip (with crown for owner) + status chip
//       position · email
//       registered date + voice/consent indicators
//     3-dot menu on the right with 編集 / PIN再設定 / 削除 options
//
// Spike source: spike/src/components/settings/StaffSettings.tsx (~464 lines)
//
// Existing wiring preserved (do NOT break what works):
//   - deleteStaff server action
//   - uploadStaffAvatar server action (now wired to the avatar click, not the row)
//   - StaffForm (mode="create" | "edit") — the actual mutation surface
//   - PinSetup dialog
//
// What stays as a placeholder for now:
//   - Voice enrollment / consent indicators read from staff fields that
//     don't exist yet (voice_enrolled_at, recording_consent). Rendered
//     when present; hidden otherwise. ANTHONY: see MERGE_NOTES "Settings
//     handoff" section for the staff schema TODOs.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Crown, KeyRound, Mic, MoreVertical, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteStaff, uploadStaffAvatar } from '@/actions/staff'
import type { StoreRow } from '@/actions/stores'
import { StaffConsentStatusBadge } from '@/components/coaching/redesign/StaffConsentStatusBadge'
import { StaffForm } from './StaffForm'
import { PinSetup } from './PinSetup'
import { VoiceEnrollmentDialog } from './VoiceEnrollmentDialog'
import { revokeVoiceAction } from '@/actions/voice'

interface StaffMember {
  id: string
  full_name: string | null
  display_role?: string | null
  position?: string | null
  email?: string | null
  phone?: string | null
  avatar_url?: string | null
  has_pin?: boolean
  created_at: string
  /** Roster card with no login attached (lib/staff.ts StaffMember.unlinked)
   *  — threaded to StaffForm so the authority section renders its honest
   *  state instead of fetching permissions that can't exist. */
  unlinked?: boolean
  /** ANTHONY: optional fields the spike tracks but karute schema hasn't
   *  added yet. Voice indicator + consent badge render only when these
   *  exist. */
  voice_enrolled_at?: string | null
  recording_consent?: boolean | null
  /** ANTHONY: per-staff coaching-consent rollup (different from
   *  recording_consent above — this is the AI coaching opt-in
   *  managed by CoachingConsentDialog). When the
   *  coaching_consent_rollup view lands, hydrate this field
   *  per row:
   *
   *    select staff_id, granted, given_at, policy_version
   *    from coaching_consent_rollup
   *    where business_id = $1
   *
   *  RLS: owner of the staff's store reads the rollup. Owners
   *  NEVER see the raw consent_log rows (decline reasons,
   *  flip-flops).
   *
   *  Render contract: StaffRow shows <StaffConsentStatusBadge>
   *  only when this field is non-null. Pending / pre-decision
   *  staff leave it null and the badge stays hidden. */
  coachingConsent?: { granted: boolean; givenAt?: string | null } | null
}

interface StaffListProps {
  staffList: StaffMember[]
  activeStaffId: string | null
  /** The currently logged-in user's staff profile ID */
  currentUserId?: string | null
  /** staff.manage capability — gates add / edit-any / delete. Was `isOwner`;
   *  widened to the capability so an SV/manager the owner granted staff.manage
   *  gets the same controls the server already lets them use. A staff member can
   *  still edit/set-PIN on THEMSELVES regardless (self === currentUserId). */
  canManageStaff?: boolean
  /** Server-persisted enrollments (org-settings voice_enrollments, status
   *  'saved'): staff profile id → consent_at ISO. */
  voiceEnrollments?: Record<string, string | null>
  /** Plan staff cap (armed billing only) — shows the N/M meter and locks the
   *  add button at the limit. Null → no cap UI (today's rendering). */
  staffCap?: { limit: number; atLimit: boolean } | null
  /** Threaded down to StaffForm (design-parity packet 12 §S4a, T3) — see
   *  StaffSection's doc comments for why these replace two client fetches. */
  businessType?: string
  stores?: StoreRow[]
  featureMultiStore?: boolean
}

function formatJpDate(dateString: string, locale: 'ja' | 'en'): string {
  const date = new Date(dateString)
  return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: locale === 'ja' ? 'long' : 'short',
    day: 'numeric',
  })
}

function initialsOf(name: string | null): string {
  if (!name) return '?'
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const first = seg.segment(name.trim())[Symbol.iterator]().next().value as
    | { segment?: string }
    | undefined
  return (first?.segment ?? name[0] ?? '?').toUpperCase()
}

export function StaffList({
  staffList,
  activeStaffId,
  currentUserId,
  canManageStaff = false,
  voiceEnrollments,
  staffCap,
  businessType,
  stores,
  featureMultiStore,
}: StaffListProps) {
  const ts = useTranslations('settings')
  const tc = useTranslations('common')
  const tStaff = useTranslations('staff')
  const tPin = useTranslations('pin')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
  const [pinSetupStaff, setPinSetupStaff] = useState<StaffMember | null>(null)
  const [voiceEnrollStaff, setVoiceEnrollStaff] = useState<StaffMember | null>(
    null,
  )
  // Local mirror of voice-enrollment timestamps so the UI flow demonstrates
  // end-to-end (consent → record → complete → row chip flips to 声登録済)
  // before Anthony wires real persistence. When the server-backed
  // `voice_enrolled_at` column exists, drop this state — the row already
  // reads from staff.voice_enrolled_at and the chip will light up
  // automatically.
  const [localEnrollments, setLocalEnrollments] = useState<
    Record<string, string | null>
  >({})

  async function handleDelete(staff: StaffMember) {
    const confirmed = window.confirm(
      tStaff('deleteConfirm', { name: staff.full_name ?? '' }),
    )
    if (!confirmed) return
    try {
      const res = await deleteStaff(staff.id)
      if (res?.error) toast.error(res.error) // translated (permission / last-member guard)
    } catch (err) {
      // deleteStaff no longer throws for user-facing failures; this catches a
      // transport-level rejection only.
      toast.error(err instanceof Error ? err.message : tStaff('failedToDelete'))
    }
  }

  // Header row — title + count on the left, icon button on the right
  // (UserPlus + 追加, matching the spike's add affordance). Always
  // visible even when staff list is empty.
  const header = (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {ts('staffMembers')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {staffCap
            ? ts('staffCountWithLimit', {
                n: staffList.length,
                limit: staffCap.limit,
              })
            : ts('staffCountSuffix', { n: staffList.length })}
        </p>
        {/* Plan cap reached — the button below locks; the server enforces the
            same gate (staffAddAllowed), this is just the honest heads-up. */}
        {staffCap?.atLimit && canManageStaff && (
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
            {ts('staffLimitHint')}
          </p>
        )}
      </div>
      {canManageStaff && (
        <Button
          size="sm"
          onClick={() => setShowCreateForm(true)}
          disabled={staffCap?.atLimit}
          title={staffCap?.atLimit ? ts('staffLimitHint') : undefined}
          className="inline-flex h-9 items-center gap-1.5"
        >
          <UserPlus className="size-4" aria-hidden />
          {tc('add')}
        </Button>
      )}
    </div>
  )

  // Empty state — header still renders so the add button stays reachable.
  if (staffList.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">{ts('noStaff')}</p>
        </div>
        {showCreateForm && (
          <StaffForm
            mode="create"
            onClose={() => setShowCreateForm(false)}
            businessType={businessType}
            stores={stores}
            featureMultiStore={featureMultiStore}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header}

      {/* Single rounded container with divide-y between rows — same
       *  visual idiom as the customer/karute/reservation lists. */}
      <div className="overflow-hidden rounded-xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 dark:ring-white/5">
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {staffList.map((staff) => {
            // Effective enrollment ISO — server field if present, otherwise
            // the local mirror we just set after a successful flow. Once
            // Anthony wires real persistence the local mirror is stale and
            // can be dropped (drop `localEnrollments` entirely + this
            // fallback expression).
            const enrolledAt =
              staff.id in localEnrollments
                ? localEnrollments[staff.id]
                : (staff.voice_enrolled_at ?? voiceEnrollments?.[staff.id] ?? null)
            return (
              <StaffRow
                key={staff.id}
                staff={staff}
                isActive={staff.id === activeStaffId}
                // Edit is a MANAGE surface (updateStaff requires staff.manage).
                // Self-service name/position editing belongs on /profile, not
                // here — including self led straight to updateStaff's rejection.
                canEdit={canManageStaff}
                canDelete={canManageStaff && staff.display_role !== 'owner'}
                // PIN + voice stay self-service: setStaffPin returns a clean
                // error contract (no throw) and a staff member manages their own.
                canSetPin={canManageStaff || staff.id === currentUserId}
                onEdit={() => setEditingStaff(staff)}
                onSetPin={() => setPinSetupStaff(staff)}
                onDelete={() => handleDelete(staff)}
                voiceEnrolledAt={enrolledAt}
                onEnrollVoice={() => setVoiceEnrollStaff(staff)}
                onRevokeVoice={() => {
                  // REAL revoke: deletes the stored sample + records the
                  // revocation (audit trail). Local mirror cleared so the
                  // chip snaps back immediately; server state follows via
                  // the revalidated settings page.
                  void revokeVoiceAction(staff.id).then((res) => {
                    if (!res.ok) {
                      // The store clamp is the one refusal the staffer can act
                      // on; every other failure stays silent as before.
                      if (res.reason === 'store_scope') {
                        toast.error(ts('staffStoreScopeDenied'))
                      }
                      return
                    }
                    setLocalEnrollments((m) => ({ ...m, [staff.id]: null }))
                  })
                }}
                labels={{
                  owner: ts('accountOwner'),
                  active: ts('active'),
                  added: tStaff('added', { date: '' }).replace(/\s*$/, '').replace(/—|-/g, '').trim(),
                  pinNotSet: ts('pinNotSet'),
                  consentGranted: ts('consentGranted'),
                  voiceEnrolled: ts('voiceEnrolled'),
                  voiceUnregistered: ts('voiceUnregistered'),
                  voiceEnrollCta: ts('voiceEnrollCta'),
                  voiceRevoke: ts('voiceRevoke'),
                  edit: tc('edit'),
                  setPin: tPin('setPin'),
                  resetPin: tPin('resetPin'),
                  delete: tc('delete'),
                }}
              />
            )
          })}
        </div>
      </div>

      {showCreateForm && (
        <StaffForm
          mode="create"
          onClose={() => setShowCreateForm(false)}
          businessType={businessType}
          stores={stores}
          featureMultiStore={featureMultiStore}
        />
      )}

      {editingStaff && (
        <StaffForm
          mode="edit"
          staff={{
            id: editingStaff.id,
            name: editingStaff.full_name ?? '',
            position: editingStaff.position ?? '',
            email: editingStaff.email ?? '',
            phone: editingStaff.phone ?? '',
            avatarUrl: editingStaff.avatar_url ?? undefined,
            unlinked: editingStaff.unlinked,
          }}
          businessType={businessType}
          stores={stores}
          featureMultiStore={featureMultiStore}
          onClose={() => setEditingStaff(null)}
        />
      )}

      {pinSetupStaff && (
        <PinSetup
          staffId={pinSetupStaff.id}
          staffName={pinSetupStaff.full_name ?? 'Staff'}
          hasPin={!!pinSetupStaff.has_pin}
          onClose={() => setPinSetupStaff(null)}
        />
      )}

      {voiceEnrollStaff && (
        <VoiceEnrollmentDialog
          open
          staffId={voiceEnrollStaff.id}
          staffName={voiceEnrollStaff.full_name ?? 'Staff'}
          onClose={() => setVoiceEnrollStaff(null)}
          onEnrolled={(enrolledAt) => {
            // Server-confirmed timestamp (enrollVoiceAction) — local mirror
            // flips the chip immediately; revalidation carries it after.
            setLocalEnrollments((m) => ({
              ...m,
              [voiceEnrollStaff.id]: enrolledAt,
            }))
          }}
        />
      )}
    </div>
  )
}

interface StaffRowProps {
  staff: StaffMember
  isActive: boolean
  canEdit: boolean
  canDelete: boolean
  canSetPin: boolean
  onEdit: () => void
  onSetPin: () => void
  onDelete: () => void
  /** ISO when voice was enrolled. Null = not enrolled — row shows the
   *  "声を登録（任意）" CTA chip; tapping it fires onEnrollVoice. */
  voiceEnrolledAt: string | null
  onEnrollVoice: () => void
  /** Fires from the × on the 声登録済 chip when enrolled. */
  onRevokeVoice: () => void
  labels: {
    owner: string
    active: string
    added: string
    pinNotSet: string
    consentGranted: string
    voiceEnrolled: string
    voiceUnregistered: string
    voiceEnrollCta: string
    voiceRevoke: string
    edit: string
    setPin: string
    resetPin: string
    delete: string
  }
}

function StaffRow({
  staff,
  isActive,
  canEdit,
  canDelete,
  canSetPin,
  onEdit,
  onSetPin,
  onDelete,
  voiceEnrolledAt,
  onEnrollVoice,
  onRevokeVoice,
  labels,
}: StaffRowProps) {
  const isOwner = staff.display_role === 'owner'
  const initials = initialsOf(staff.full_name)
  const registered = formatJpDate(staff.created_at, 'ja')
  // Voice chip variants: enrolled (with date + revoke ×) vs CTA (not yet
  // enrolled — clickable to open the enrollment dialog). Always renders
  // when canEdit so staff can opt in or revoke at any time.
  const voiceEnrolledDate = voiceEnrolledAt
    ? voiceEnrolledAt.slice(0, 10) // YYYY-MM-DD
    : null

  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      {/* Avatar — click to upload (existing wiring preserved). */}
      <AvatarUpload staffId={staff.id} avatarUrl={staff.avatar_url} initials={initials} />

      <div className="min-w-0 flex-1">
        {/* Line 1: name + role chip + status chip */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-medium text-foreground">
            {staff.full_name ?? '(No name)'}
          </span>
          {isOwner && (
            <span
              className="inline-flex h-5 items-center gap-1 rounded-full bg-amber-50 px-1.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20"
              title={labels.owner}
            >
              <Crown className="size-2.5" aria-hidden />
              {labels.owner}
            </span>
          )}
          {isActive && (
            <span className="inline-flex h-5 items-center rounded-full bg-green-50 px-2 text-[10px] font-medium text-green-700 ring-1 ring-green-200/70 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/20">
              {labels.active}
            </span>
          )}
        </div>

        {/* Line 2: position · email (if present) */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {staff.position && <span>{staff.position}</span>}
          {staff.position && staff.email && <span aria-hidden>·</span>}
          {staff.email && <span className="truncate">{staff.email}</span>}
        </div>

        {/* Line 3: registered date */}
        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {labels.added} {registered}
        </div>

        {/* Line 4: status indicators — PIN / consent / voice. The voice
         *  chip ALWAYS renders for editable rows (CTA when not enrolled,
         *  enrolled+revoke when enrolled). PIN + consent chips only
         *  render when their values are set. */}
        {(!staff.has_pin ||
          staff.recording_consent ||
          staff.coachingConsent ||
          voiceEnrolledAt ||
          canEdit) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!staff.has_pin && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-amber-50 px-2 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200/70 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20">
                {labels.pinNotSet}
              </span>
            )}
            {staff.recording_consent && (
              <span className="inline-flex h-5 items-center rounded-full bg-green-50 px-2 text-[10px] font-medium text-green-700 ring-1 ring-green-200/70 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/20">
                ✓ {labels.consentGranted}
              </span>
            )}
            {/* Coaching consent (separate from recording_consent above)
             *  — only renders when Anthony's coaching_consent_rollup
             *  data is hydrated into staff.coachingConsent. See the
             *  StaffMember interface above for the wiring contract. */}
            {staff.coachingConsent && !isOwner && (
              <StaffConsentStatusBadge
                granted={staff.coachingConsent.granted}
                givenAt={staff.coachingConsent.givenAt}
              />
            )}
            {voiceEnrolledAt ? (
              <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-blue-50 px-2 text-[10px] font-medium tabular-nums text-blue-700 ring-1 ring-blue-200/70 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20">
                <Mic className="size-2.5" aria-hidden />
                {labels.voiceEnrolled}
                {voiceEnrolledDate && (
                  <>
                    <span aria-hidden className="opacity-50">
                      ·
                    </span>
                    <span>{voiceEnrolledDate}</span>
                  </>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={onRevokeVoice}
                    aria-label={labels.voiceRevoke}
                    className="-mr-1 inline-flex size-3.5 items-center justify-center rounded-full text-blue-700/70 hover:bg-blue-200/40 hover:text-blue-900 dark:text-blue-300/70 dark:hover:bg-blue-500/20 dark:hover:text-blue-200"
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </span>
            ) : canEdit ? (
              <button
                type="button"
                onClick={onEnrollVoice}
                className="inline-flex h-5 items-center gap-1 rounded-full bg-card px-2 text-[10px] font-medium text-muted-foreground ring-1 ring-border hover:text-foreground hover:ring-foreground/30"
              >
                <Mic className="size-2.5" aria-hidden />
                {labels.voiceEnrollCta}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* 3-dot dropdown — replaces the inline button cluster. Edit /
       *  PIN / Delete actions surface here, conditionally shown based
       *  on caller permissions (canEdit / canSetPin / canDelete). */}
      {(canEdit || canSetPin || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="actions"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            {canEdit && (
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <Pencil className="size-3.5" />
                {labels.edit}
              </DropdownMenuItem>
            )}
            {canSetPin && (
              <DropdownMenuItem onClick={onSetPin} className="gap-2">
                <KeyRound className="size-3.5" />
                {staff.has_pin ? labels.resetPin : labels.setPin}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="gap-2 text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-500/10 dark:focus:text-red-300"
                >
                  <Trash2 className="size-3.5" />
                  {labels.delete}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// Avatar with click-to-upload affordance. Same wiring as the previous
// implementation — file input hidden behind the avatar circle; upload
// fires on file selection via the existing `uploadStaffAvatar` action.
function AvatarUpload({
  staffId,
  avatarUrl,
  initials,
}: {
  staffId: string
  avatarUrl: string | null | undefined
  initials: string
}) {
  const ts = useTranslations('settings')
  return (
    <label className="group/avatar relative size-10 shrink-0 cursor-pointer">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="size-10 rounded-full object-cover ring-1 ring-black/5"
        />
      ) : (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-black/5">
          {initials}
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover/avatar:opacity-100">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const fd = new FormData()
          fd.append('file', file)
          const result = await uploadStaffAvatar(staffId, fd)
          if ('error' in result) toast.error(result.error)
          else toast.success(ts('avatarUploaded'))
        }}
      />
    </label>
  )
}

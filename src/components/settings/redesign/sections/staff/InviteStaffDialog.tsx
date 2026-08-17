'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { UserPlus, Copy, Check, X } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { publicSiteOrigin } from '@/lib/platform'
import { INVITE_ROLES, type InviteRole } from '@/lib/validations/invite'
import { createInvite, listInvites, revokeInvite, type InviteRow } from '@/actions/invites'

const inputCls =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

interface InviteStaffDialogProps {
  /** Existing staff rows the owner can invite to log in. Choosing one carries its
   *  id so acceptInvite LINKS that record instead of minting a duplicate. */
  staff?: { id: string; full_name: string | null; email?: string | null }[]
}

export function InviteStaffDialog({ staff = [] }: InviteStaffDialogProps) {
  const t = useTranslations('invite')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [staffId, setStaffId] = useState('')
  const [role, setRole] = useState<InviteRole>('STYLIST')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState<InviteRow[]>([])

  async function refresh() {
    setPending(await listInvites())
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setLink(null)
      setError(null)
      setEmail('')
      setStaffId('')
      void refresh()
    }
  }

  // Picking an existing staff member carries their id (the link) and prefills
  // their email when we have one — the owner can still edit/supply the login email.
  function onSelectStaff(id: string) {
    setStaffId(id)
    const s = staff.find((x) => x.id === id)
    if (s?.email) setEmail(s.email)
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setLink(null)
    const res = await createInvite({ email, role, staffId: staffId || undefined })
    setLoading(false)
    if ('error' in res) {
      // Machine code from the plan gate → honest copy (STORE_LIMIT precedent).
      setError(res.error === 'STAFF_LIMIT_REACHED' ? t('staffLimitReached') : res.error)
      return
    }
    setLink(`${publicSiteOrigin()}/${locale}/join?token=${res.token}`)
    setEmail('')
    void refresh()
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the link is still selectable in the field */
    }
  }

  async function handleRevoke(id: string) {
    await revokeInvite(id)
    void refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
      >
        <UserPlus className="size-3.5" />
        {t('inviteStaff')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inviteStaff')}</DialogTitle>
          <DialogDescription>{t('inviteDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate} className="space-y-3">
          {staff.length > 0 && (
            <div>
              <label htmlFor="invite-staff" className="block text-xs font-medium mb-1">
                {t('inviteExistingLabel')}
              </label>
              <select
                id="invite-staff"
                value={staffId}
                onChange={(e) => onSelectStaff(e.target.value)}
                className={inputCls}
              >
                <option value="">{t('inviteExistingNone')}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name ?? '—'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="invite-email" className="block text-xs font-medium mb-1">
              {t('inviteEmailLabel')}
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('inviteRoleLabel')}
            </label>
            <div className="flex flex-col gap-1.5">
              {INVITE_ROLES.map((r) => {
                const selected = role === r
                return (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setRole(r)}
                    aria-pressed={selected}
                    className={`flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'border-ring ring-1 ring-ring bg-muted/40'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <span className="text-sm font-medium">{t(`role_${r}`)}</span>
                    <span className="text-xs text-muted-foreground">{t(`role_${r}_desc`)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email}>
            {loading ? t('inviteCreating') : t('inviteCreate')}
          </Button>
        </form>

        {link && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">{t('inviteLinkReady')}</p>
            <div className="flex items-center gap-2">
              <input readOnly value={link} className={`${inputCls} text-xs`} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                onClick={copy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-2 text-xs hover:bg-muted"
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                {copied ? t('copied') : t('copy')}
              </button>
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div className="border-t border-border/40 pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">{t('pendingInvites')}</p>
            <ul className="space-y-1.5">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {inv.email}
                    <span className="ml-1.5 text-muted-foreground">· {t(`role_${inv.role}`)}</span>
                    {inv.linked && (
                      <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        {t('linkedBadge')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRevoke(inv.id)}
                    title={t('revoke')}
                    className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-red-500"
                  >
                    <X className="size-3" />
                    {t('revoke')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

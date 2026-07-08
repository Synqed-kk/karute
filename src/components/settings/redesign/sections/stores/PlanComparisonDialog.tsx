'use client'

// ─────────────────────────────────────────────────────────────
// PlanComparisonDialog — the plan/paywall surface, hosted in 店舗
// ─────────────────────────────────────────────────────────────
// Consolidated here (per Liam's IA) instead of a standalone
// "契約" settings tab. Opened by the 「プランを見る・変更」 button in
// StoresSection. Body is the shared PlanComparisonGrid, fed the
// REAL per-account entitlement (tier + isUnlimited) so the current
// plan and the unlimited-account state are truthful — not the
// localStorage mock the old subscription tab rendered.

import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SubscriptionTier } from '@/lib/subscription/types'
import { PlanComparisonGrid } from '../subscription/PlanComparisonGrid'

interface PlanComparisonDialogProps {
  open: boolean
  onClose: () => void
  /** Live tier from the entitlement (marks the current plan). */
  currentTier?: SubscriptionTier
  /** Unlimited / comped account (Liam) — shows the all-unlocked state. */
  isUnlimited?: boolean
}

export function PlanComparisonDialog({
  open,
  onClose,
  currentTier,
  isUnlimited,
}: PlanComparisonDialogProps) {
  const t = useTranslations('settings.stores.plan')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDesc')}</DialogDescription>
        </DialogHeader>
        <PlanComparisonGrid currentTier={currentTier} isUnlimited={isUnlimited} />
      </DialogContent>
    </Dialog>
  )
}

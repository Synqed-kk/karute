/**
 * @jest-environment jsdom
 *
 * Render coverage for SubscriptionSummaryCard (PR #95/replay/21). The card is
 * hook-driven (useSubscription → localStorage) and branches across five visual
 * states. next-intl is mocked so each branch is identified by the translation
 * KEY it renders (the mocked t() echoes its key).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))

import { SubscriptionSummaryCard } from '@/components/settings/redesign/sections/stores/SubscriptionSummaryCard'
import { subscriptionMockSeed, type SubscriptionState } from '@/lib/subscription/types'

const STORAGE_KEY = 'synqed-karute-subscription'

function seed(over: Partial<SubscriptionState>) {
  const state: SubscriptionState = { ...subscriptionMockSeed, ...over }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('SubscriptionSummaryCard', () => {
  it('renders the past_due branch with its fix-payment CTA', () => {
    seed({ tier: 'professional', status: 'past_due' })
    render(<SubscriptionSummaryCard />)
    expect(screen.getByText('pastDueTitle')).toBeInTheDocument()
    expect(screen.getByText('pastDueCta')).toBeInTheDocument()
  })

  it('renders the trialing branch', () => {
    seed({ tier: 'trial', status: 'trialing', trialEndsAt: '2099-01-01T00:00:00Z' })
    render(<SubscriptionSummaryCard />)
    expect(screen.getByText('trialTitle')).toBeInTheDocument()
    expect(screen.getByText('trialCta')).toBeInTheDocument()
  })

  it('renders the free upgrade-prompt branch', () => {
    seed({ tier: 'free', status: 'free' })
    render(<SubscriptionSummaryCard />)
    expect(screen.getByText('freeTitle')).toBeInTheDocument()
    expect(screen.getByText('freeCta')).toBeInTheDocument()
  })

  it('renders the active paid branch with a manage CTA', () => {
    seed({ tier: 'professional', status: 'active', pricePerStoreJpy: 11980, storeCount: 2, nextBillingDate: '2026-07-01T00:00:00Z' })
    render(<SubscriptionSummaryCard />)
    expect(screen.getByText('activeTitle')).toBeInTheDocument()
    expect(screen.getByText('manageCta')).toBeInTheDocument()
  })
})

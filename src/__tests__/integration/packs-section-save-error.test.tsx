/** @jest-environment jsdom */
// PacksSection save() must surface soft { error } results (design-parity
// packet 12 §S1 fleet finding): the section detected failure ONLY via a
// thrown rejection, but the thin port structurally never rejects (every
// failure lands as { error }) and web's own permission denial is a soft
// { error } too — both previously fell through to the success toast, a
// false 保存しました on a pricing surface. Fails on the ignore-the-result shape.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/actions/org-settings', () => ({ upsertOrgSettings: jest.fn() }))

import { toast } from 'sonner'
import { upsertOrgSettings } from '@/actions/org-settings'
import { PacksSection } from '@/components/settings/redesign/sections/PacksSection'

beforeEach(() => jest.clearAllMocks())

describe('PacksSection — save surfaces soft { error } results', () => {
  it('a soft { error } result → saveFailed toast, no success toast', async () => {
    ;(upsertOrgSettings as jest.Mock).mockResolvedValue({
      error: 'You do not have permission to change settings.',
    })
    render(<PacksSection orgSettings={null} />)

    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('saveFailed'))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a { success: true } result still shows the success toast', async () => {
    ;(upsertOrgSettings as jest.Mock).mockResolvedValue({ success: true })
    render(<PacksSection orgSettings={null} />)

    fireEvent.click(screen.getByText('save'))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('saved'))
    expect(toast.error).not.toHaveBeenCalled()
  })
})

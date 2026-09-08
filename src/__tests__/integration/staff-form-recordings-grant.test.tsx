/** @jest-environment jsdom */
// 全スタッフの録音 row in StaffForm's 個別の権限 list (⚖ 9/3 named grant, slice
// ② of build 23). Rendered against the REAL ja.json, so the label the owner
// actually reads is what this pins — a call-site key typo fails here.
//
// THE MUTANT: restore `CAPABILITIES.filter((c) => c !== 'recordings.viewAll')`
// in StaffForm.tsx and both cases below go red — the row disappears and the
// tick can never reach setStaffPermissions.
//
// The row shows for EVERY non-owner staff member, not only a manager's screen
// (⚖ design O11: per person, never a role — the same uniform grammar 監査ログ
// and 予約同期 already use). The server is what refuses a non-owner's grant;
// this form is convenience, exactly as its own header says.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const getStaffPermissions = jest.fn()
const setStaffPermissions = jest.fn<Promise<{ ok: true }>, [string, string, string[]]>(
  async () => ({ ok: true }),
)
jest.mock('@/actions/permissions', () => ({
  getStaffPermissions: (id: string) => getStaffPermissions(id),
  setStaffPermissions: (id: string, role: string, caps: string[]) =>
    setStaffPermissions(id, role, caps),
}))
jest.mock('@/actions/stores', () => ({
  getStaffStores: jest.fn(async () => []),
  setStaffStores: jest.fn(async () => ({ ok: true })),
}))
const updateStaff = jest.fn<Promise<undefined>, [string, Record<string, unknown>]>(
  async () => undefined,
)
jest.mock('@/actions/staff', () => ({
  createStaff: jest.fn(async () => undefined),
  updateStaff: (id: string, data: Record<string, unknown>) => updateStaff(id, data),
}))

import { StaffForm } from '@/components/staff/StaffForm'

// The REAL ja.json text (messages/ja.json → permissions.cap_recordings_viewAll).
const LABEL = '他スタッフの録音の再生・文字起こしの閲覧'

function renderReady(role = 'practitioner') {
  getStaffPermissions.mockResolvedValue({
    permissionRole: role,
    capabilities: [],
    isOwner: false,
  })
  return render(
    <StaffForm
      mode="edit"
      staff={{ id: 'staff-1', name: '北野', email: 'kitano@example.jp' }}
      onClose={() => {}}
    />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('全スタッフの録音 row — the named grant', () => {
  it('renders in 個別の権限 with the real ja.json label, unticked by default', async () => {
    renderReady()
    const box = (await screen.findByLabelText(LABEL)) as HTMLInputElement
    expect(box.type).toBe('checkbox')
    expect(box.checked).toBe(false)
    // It sits INSIDE the 個別の権限 list, not loose in the 権限 block.
    expect(box.closest('label')!.parentElement!.textContent).toContain('個別の権限')
  })

  it('ticking it and pressing 保存 sends recordings.viewAll through the write seam', async () => {
    renderReady()
    fireEvent.click(await screen.findByLabelText(LABEL))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(setStaffPermissions).toHaveBeenCalled())
    expect(setStaffPermissions.mock.calls[0][2]).toContain('recordings.viewAll')
  })

  it('shows on every non-owner role, not only a manager (⚖ design O11)', async () => {
    for (const role of ['manager', 'senior', 'practitioner', 'frontdesk', 'custom']) {
      const { unmount } = renderReady(role)
      expect(await screen.findByLabelText(LABEL)).toBeTruthy()
      unmount()
    }
  })
})

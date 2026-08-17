/** @jest-environment jsdom */
// 経営メンバー toggle in StaffForm's 権限 block (signed-off mock §①, 2026-08-18).
// Rendered against the REAL ja.json, so a call-site key typo fails here.
//
// Three branches, three shapes:
//   (a) normal staff  — editable row between the role preset and 個別の権限
//   (b) account owner — the row is the owner's ONE editable control; the
//       full-access banner stays. It rides updateStaff, NOT the permissions
//       write (setStaffPermissionsCore refuses owner targets by design), so
//       this is the only seam that can flag the owner at all.
//   (c) unlinked      — disabled, and 保存 writes no flag (no profiles row).
//
// Plus the no-clobber rule: an UNTOUCHED toggle sends no `isManagement` key,
// so an unrelated name edit can never clear someone's flag.
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
jest.mock('@/actions/permissions', () => ({
  getStaffPermissions: (id: string) => getStaffPermissions(id),
  setStaffPermissions: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/stores', () => ({
  getStaffStores: jest.fn(async () => []),
  setStaffStores: jest.fn(async () => ({ ok: true })),
}))
const updateStaff = jest.fn()
jest.mock('@/actions/staff', () => ({
  createStaff: jest.fn(async () => undefined),
  updateStaff: (id: string, data: Record<string, unknown>) => updateStaff(id, data),
}))

import { StaffForm } from '@/components/staff/StaffForm'

const LABEL = '経営メンバー'
const HINT = '予約表や担当スタッフの選択肢には表示されません（予約が入っている日は表示されます）'
const UNLINKED_HINT = '登録が完了すると設定できます'

function asReady() {
  getStaffPermissions.mockResolvedValue({
    permissionRole: 'practitioner',
    capabilities: [],
    isOwner: false,
  })
}
function asOwner() {
  getStaffPermissions.mockResolvedValue({
    permissionRole: 'owner',
    capabilities: [],
    isOwner: true,
  })
}

function renderForm(staff: Record<string, unknown>) {
  return render(
    <StaffForm
      mode="edit"
      staff={{ id: 'staff-1', name: '北野', email: 'kitano@example.jp', ...staff }}
      onClose={() => {}}
    />,
  )
}

const toggle = () => screen.getByLabelText(LABEL) as HTMLInputElement

beforeEach(() => {
  jest.clearAllMocks()
})

describe('経営メンバー toggle — normal staff', () => {
  it('renders the row + hint, seeded from the stored value', async () => {
    asReady()
    renderForm({ isManagement: true })
    expect(await screen.findByLabelText(LABEL)).toBeTruthy()
    expect(toggle().checked).toBe(true)
    expect(screen.getByText(HINT)).toBeTruthy()
  })

  it('sits between the role preset and 個別の権限 (mock §① order)', async () => {
    asReady()
    renderForm({})
    await screen.findByLabelText(LABEL)
    // The 権限 block = the row's own parent (dialog content is portalled, so
    // walk up from the control rather than querying the render container).
    const block = toggle().closest('label')!.parentElement!
    const kids = [...block.children]
    const roleSelect = kids.findIndex((n) => n.tagName === 'SELECT')
    const row = kids.findIndex((n) => n.contains(toggle()))
    const caps = kids.findIndex((n) => n.textContent?.includes('個別の権限'))
    expect(roleSelect).toBeGreaterThanOrEqual(0)
    expect(row).toBeGreaterThan(roleSelect)
    expect(caps).toBeGreaterThan(row)
  })

  it('flipping it on and saving sends isManagement through the write seam', async () => {
    asReady()
    renderForm({ isManagement: false })
    fireEvent.click(await screen.findByLabelText(LABEL))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateStaff).toHaveBeenCalled())
    expect(updateStaff.mock.calls[0][1]).toEqual(
      expect.objectContaining({ isManagement: true }),
    )
  })

  it('an UNTOUCHED toggle sends no isManagement key — a name edit never clears a flag', async () => {
    asReady()
    renderForm({ isManagement: true })
    await screen.findByLabelText(LABEL)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateStaff).toHaveBeenCalled())
    expect(updateStaff.mock.calls[0][1]).not.toHaveProperty('isManagement')
  })
})

describe('経営メンバー toggle — account owner (ruling Ⓐ)', () => {
  it('renders alongside the full-access banner and writes through updateStaff', async () => {
    asOwner()
    renderForm({ isManagement: false })
    expect(await screen.findByLabelText(LABEL)).toBeTruthy()
    expect(screen.getByText('アカウントオーナー — すべての権限があります。')).toBeTruthy()

    fireEvent.click(toggle())
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateStaff).toHaveBeenCalled())
    expect(updateStaff.mock.calls[0][1]).toEqual(
      expect.objectContaining({ isManagement: true }),
    )
  })
})

describe('経営メンバー toggle — unlinked staff', () => {
  it('is disabled with its own hint and writes nothing', async () => {
    renderForm({ id: 'synqed-only-1', unlinked: true })
    const box = toggle()
    expect(box.disabled).toBe(true)
    expect(screen.getByText(UNLINKED_HINT)).toBeTruthy()
    expect(getStaffPermissions).not.toHaveBeenCalled()

    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateStaff).toHaveBeenCalled())
    expect(updateStaff.mock.calls[0][1]).not.toHaveProperty('isManagement')
  })
})

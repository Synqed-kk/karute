/** @jest-environment jsdom */
// THE PERMISSIONS SHEET vs NOT_YET_TOGGLEABLE (⚖ fold round 2, F6).
//
// `customers.manage` is deliberately absent from the 個別の権限 list: the
// implied-capability rule in effectiveCapabilities() reads an override that
// lacks it as "this row predates the capability" and adds it back, so a
// checkbox would be one that never sticks — the exact failure that function's
// own recordings.viewAll note describes. The rule and the missing checkbox are
// ONE decision (see NOT_YET_TOGGLEABLE's REMOVAL note).
//
// The blind round proved the guard was not a guard: asserting
// `NOT_YET_TOGGLEABLE.has('customers.manage')` pins the CONSTANT, and deleting
// the `.filter(...)` from StaffForm left all 638 suites green. These cases pin
// the BEHAVIOUR — the sheet the owner actually reads — against the real
// ja.json, so the halves can no longer drift apart silently.
//
// THE MUTANT: drop the filter from StaffForm.tsx and the first case goes red
// (`proof-p1/mutate.sh staffform`).
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
jest.mock('@/actions/staff', () => ({
  createStaff: jest.fn(async () => undefined),
  updateStaff: jest.fn(async () => undefined),
}))

import { StaffForm } from '@/components/staff/StaffForm'
import { CAPABILITIES, NOT_YET_TOGGLEABLE, effectiveCapabilities } from '@/lib/auth/permissions'
import ja from '../../../messages/ja.json'

const labelFor = (cap: string) =>
  (ja.permissions as Record<string, string>)[`cap_${cap.replace('.', '_')}`]

function renderSheet(role = 'practitioner', capabilities: string[] = []) {
  getStaffPermissions.mockResolvedValue({ permissionRole: role, capabilities, isOwner: false })
  return render(
    <StaffForm
      mode="edit"
      staff={{ id: 'staff-1', name: '北野', email: 'kitano@example.jp' }}
      onClose={() => {}}
    />,
  )
}

beforeEach(() => jest.clearAllMocks())

describe('個別の権限 — the sheet offers no switch for 顧客の登録・編集', () => {
  it('renders NO control for customers.manage, by its real ja.json label', async () => {
    renderSheet()
    // Wait for the sheet itself, so an absent label cannot pass by arriving late.
    expect(await screen.findByLabelText(labelFor('customers.view'))).toBeTruthy()
    expect(screen.queryByLabelText(labelFor('customers.manage'))).toBeNull()
    expect(screen.queryByText(labelFor('customers.manage'))).toBeNull()
  })

  it('offers every OTHER capability, so this is one omission and not a broken list', async () => {
    renderSheet()
    await screen.findByLabelText(labelFor('customers.view'))
    for (const cap of CAPABILITIES) {
      const present = screen.queryByLabelText(labelFor(cap)) !== null
      expect({ cap, present }).toEqual({ cap, present: !NOT_YET_TOGGLEABLE.has(cap) })
    }
  })

  it('holds on every non-owner role — this is per-capability, never per-role', async () => {
    for (const role of ['manager', 'senior', 'practitioner', 'frontdesk', 'custom']) {
      const { unmount } = renderSheet(role)
      await screen.findByLabelText(labelFor('customers.view'))
      expect(screen.queryByLabelText(labelFor('customers.manage'))).toBeNull()
      unmount()
    }
  })
})

// ⚖ Greptile round 2 — THE PAYLOAD, not just the picture. `caps` is seeded
// from the EFFECTIVE set, which carries the server-derived customers.manage,
// so the form used to SUBMIT a capability it never showed — and an owner
// unticking 顧客の閲覧 stored an override with manage and no view, which read
// as a deliberate grant. The server drops it now (customers.manage REQUIRES
// customers.view, effectiveCapabilities), and the form no longer sends it at
// all: two independent layers, neither relying on the other.
describe('個別の権限 — the payload carries only what the sheet can express', () => {
  it('never submits customers.manage, even when the loaded set carries it', async () => {
    renderSheet('practitioner', ['customers.view', 'customers.manage', 'records.write'])
    await screen.findByLabelText(labelFor('customers.view'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(setStaffPermissions).toHaveBeenCalled())
    const sent = setStaffPermissions.mock.calls[0][2]
    expect(sent).not.toContain('customers.manage')
    expect(sent).toContain('customers.view')
    expect(sent).toContain('records.write')
  })

  it('unticking 顧客の閲覧 sends NEITHER — the write tier cannot outlive the read tier', async () => {
    renderSheet('practitioner', ['customers.view', 'customers.manage', 'records.write'])
    fireEvent.click(await screen.findByLabelText(labelFor('customers.view')))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(setStaffPermissions).toHaveBeenCalled())
    const sent = setStaffPermissions.mock.calls[0][2]
    expect(sent).not.toContain('customers.view')
    expect(sent).not.toContain('customers.manage')
    // …and the SERVER agrees about that stored override, independently.
    expect(effectiveCapabilities('practitioner', sent).has('customers.manage')).toBe(false)
  })
})

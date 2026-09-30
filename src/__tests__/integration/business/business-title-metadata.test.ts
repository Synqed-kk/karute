/**
 * ⚖ Liam 2026-09-30 — the tab reads 「SYNQED Business」 only when ADMITTED.
 * The title is computed from the admission the layout awaits; a 404 thrown in
 * the segment (production, not admitted, any failure) gets {} and keeps the
 * root 「Karute」. A static `metadata` export here would title that 404 too.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))

import { requireBusinessAdmission } from '@/business/lib/admission'
import { generateMetadata } from '@/app/[locale]/(business)/layout'

const admission = requireBusinessAdmission as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('(business) layout title', () => {
  it('admitted → SYNQED Business', async () => {
    admission.mockResolvedValue({ userId: 'u1', email: null, businessId: 'biz-1' })
    await expect(generateMetadata()).resolves.toEqual({ title: 'SYNQED Business' })
  })
  it('not admitted (admission 404s) → {} so the root Karute title stands', async () => {
    admission.mockRejectedValue(new Error('NEXT_NOT_FOUND'))
    await expect(generateMetadata()).resolves.toEqual({})
  })
  it('any other failure → {}', async () => {
    admission.mockRejectedValue(new Error('anything'))
    await expect(generateMetadata()).resolves.toEqual({})
  })
  it('the segment never exports a static `metadata` (it would title the 404)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/layout.tsx'), 'utf8')
    expect(src).not.toMatch(/export\s+(const|let|var)\s+metadata\b/)
    expect(src).toMatch(/export async function generateMetadata\(/)
  })
})

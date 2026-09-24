'use server'

// ⚖ A2 (Liam 9/24) — カードの見た目's ONE save, the server entry. The browser sends exactly two things:
// the business it believes it is saving for, and the colour (#847's checklist). Next.js compares the
// request's Origin with its Host before any action runs (Next 16.2.3, docs 02-guides/data-security.md:540).
// The page hands this action to the screen ONLY while the practice door is ON (page.tsx).
import { requireBusinessAdmission } from '@/business/lib/admission'
import { writeReserveCardColor } from '@/business/lib/data'

export async function saveReserveCardColor(expectedBusinessId: string, next: string | null): ReturnType<typeof writeReserveCardColor> {
  const admitted = await requireBusinessAdmission()
  if (expectedBusinessId !== admitted.businessId) return { ok: false, reason: 'tenant' }
  return writeReserveCardColor(next)
}

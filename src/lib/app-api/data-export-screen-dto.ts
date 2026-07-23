// /data-export screen DTO — the Bearer twin of the page's prop surface
// (design-parity packet 23). Mirrors src/app/[locale]/(app)/data-export/
// page.tsx's own derivation field-for-field: 3 page_size=1 scope totals +
// the recipient email, so the thin screen renders DataExportView directly.

import { z } from 'zod'

export const DataExportScreenDTO = z.object({
  totals: z.object({
    customers: z.number(),
    bookings: z.number(),
    karute: z.number(),
  }),
  recipientEmail: z.string(),
})

export type DataExportScreenDTOType = z.infer<typeof DataExportScreenDTO>

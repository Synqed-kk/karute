// Force Node.js runtime — consistent with the PDF export route.
export const runtime = 'nodejs'

import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { formatKaruteAsText } from '@/lib/karute/formatKaruteText'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Auth check: must be an authenticated staff member
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Fetch the karute record with customer and entries
  const karute = await getKaruteRecord(id)

  if (!karute) {
    return new Response('Not Found', { status: 404 })
  }

  // Format as plain text
  const text = formatKaruteAsText(karute)

  // Build a safe filename using customer name and date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerName = ((karute as any).customers?.name ?? 'karute')
    .replace(/[^a-zA-Z0-9\u3000-\u9fff\s-]/g, '')
    .trim()
  const dateSource =
    (karute as { session_date?: string; created_at: string }).session_date ??
    karute.created_at
  const date = new Date(dateSource).toISOString().split('T')[0]
  const filename = `karute-${customerName}-${date}.txt`

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

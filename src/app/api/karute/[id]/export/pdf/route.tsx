// Force Node.js runtime — Edge Runtime does not have file system access,
// which is required for Font.register() to load font files via process.cwd().
export const runtime = 'nodejs'

import React from 'react'
import { renderToStream, type DocumentProps } from '@react-pdf/renderer'
import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { KarutePdfDocument } from '@/components/karute/KarutePdfDocument'

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

  // Render the PDF as a Node.js readable stream.
  // Using React.createElement instead of JSX because route files have .ts extension.
  const nodeStream = await renderToStream(
    React.createElement(KarutePdfDocument, { karute }) as React.ReactElement<DocumentProps>,
  )

  // Convert Node.js Readable stream to Web ReadableStream for Response
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk))
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err: Error) => controller.error(err))
    },
  })

  // Build a safe filename: sanitize customer name, use ISO date.
  // customers is aliased via PostgREST as customers:client_id — cast to any for field access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customerName = ((karute as any).customers?.name ?? 'karute')
    .replace(/[^a-zA-Z0-9\u3000-\u9fff\s-]/g, '')
    .trim()
  const dateSource = (karute as { session_date?: string; created_at: string }).session_date ?? karute.created_at
  const date = new Date(dateSource).toISOString().split('T')[0]
  const filename = `karute-${customerName}-${date}.pdf`

  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

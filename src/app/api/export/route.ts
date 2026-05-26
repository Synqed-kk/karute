import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listCustomers } from '@/lib/customers/queries'
import { SCOPES, isWired, type ScopeKey, type FormatKey } from '@/lib/export/scopes'

const MAX_PAGE_SIZE = 500
const MAX_ROWS = 5000

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const scope = (url.searchParams.get('scope') ?? 'customers') as ScopeKey
  const format = (url.searchParams.get('format') ?? 'csv') as FormatKey
  const privacy = url.searchParams.get('privacy') === '1'
  const columnsParam = url.searchParams.get('columns') ?? ''
  const columns = columnsParam ? columnsParam.split(',').filter(Boolean) : []

  if (!SCOPES[scope]) {
    return NextResponse.json({ error: 'Unknown scope' }, { status: 400 })
  }

  if (!isWired(scope, format)) {
    return NextResponse.json(
      { error: 'This combination is not yet wired — try customers + CSV/JSON.' },
      { status: 501 },
    )
  }

  if (scope === 'customers') {
    return exportCustomers({ columns, format, privacy })
  }

  return NextResponse.json({ error: 'Unsupported scope' }, { status: 400 })
}

async function exportCustomers({
  columns,
  format,
  privacy,
}: {
  columns: string[]
  format: FormatKey
  privacy: boolean
}) {
  const rows: Record<string, unknown>[] = []
  let page = 1
  while (rows.length < MAX_ROWS) {
    const { customers, totalPages } = await listCustomers({
      page,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'updated_at',
      sortOrder: 'desc',
    })
    for (const c of customers) {
      const row: Record<string, unknown> = {
        customer_id: c.id,
        name: privacy && c.name ? redact(c.name, c.id) : c.name,
        furigana: privacy && c.furigana ? redact(c.furigana, c.id) : c.furigana,
        phone: privacy ? redactPhone(c.phone) : c.phone,
        email: privacy ? redactEmail(c.email) : c.email,
        preferred_staff: null,
        visit_count: null,
        last_visit_at: null,
        created_at: c.created_at,
        updated_at: c.updated_at,
        notes: privacy && c.notes ? '[redacted]' : c.notes,
      }
      rows.push(row)
      if (rows.length >= MAX_ROWS) break
    }
    if (page >= totalPages) break
    page += 1
  }

  if (format === 'json') {
    const projected = rows.map((r) =>
      Object.fromEntries(columns.map((k) => [k, r[k] ?? null])),
    )
    return new NextResponse(JSON.stringify(projected, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="customers_export.json"',
      },
    })
  }

  // CSV — UTF-8 BOM so Excel renders Japanese correctly.
  const header = columns.join(',')
  const body = rows
    .map((row) => columns.map((k) => csvEscape(row[k])).join(','))
    .join('\n')
  const csv = '﻿' + header + '\n' + body
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="customers_export.csv"',
    },
  })
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function redact(value: string, salt: string): string {
  // Stable pseudonym derived from the customer id, so re-joins still work.
  return `[user-${salt.slice(0, 8)}]`
}

function redactPhone(value: string | null | undefined): string | null {
  if (!value) return value ?? null
  return value.replace(/\d/g, '*')
}

function redactEmail(value: string | null | undefined): string | null {
  if (!value) return value ?? null
  const at = value.indexOf('@')
  if (at <= 0) return '***'
  return '***' + value.slice(at)
}

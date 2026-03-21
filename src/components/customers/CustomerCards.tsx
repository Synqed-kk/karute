'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteCustomer } from '@/actions/customers'
import type { Customer } from '@/types/database'

interface CustomerCardsProps {
  customers: Customer[]
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function CustomerCards({ customers: initialCustomers }: CustomerCardsProps) {
  const [customers, setCustomers] = useState(initialCustomers)

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return
    const result = await deleteCustomer(id)
    if (result.success) {
      setCustomers((prev) => prev.filter((c) => c.id !== id))
      toast.success(`${name} deleted`)
    } else {
      toast.error(result.error)
    }
  }
  if (customers.length === 0) {
    return (
      <div className="rounded-lg border border-border py-12 text-center text-sm text-muted-foreground">
        No customers found
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {customers.map((c) => (
        <Link
          key={c.id}
          href={`/customers/${c.id}` as Parameters<typeof Link>[0]['href']}
          className="group rounded-xl border border-border/30 bg-card hover:bg-muted/30 transition-all hover:shadow-md p-4 flex items-start gap-3"
        >
          {/* Avatar */}
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {getInitials(c.name)}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                {c.name}
              </p>
              {/* Tags */}
              {(c as { tags?: string[] }).tags?.map((tag: string) => (
                <span key={tag} className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
            {c.phone && (
              <p className="text-xs text-muted-foreground mt-0.5">{c.phone}</p>
            )}
            {c.email && (
              <p className="text-xs text-muted-foreground truncate">{c.email}</p>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-1.5">
              Added {formatDate(c.created_at)}
            </p>
          </div>

          {/* Delete */}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(c.id, c.name) }}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-red-500 hover:!bg-red-500/10 transition-all"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Link>
      ))}
    </div>
  )
}

'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CustomerForm } from '@/components/customer/customer-form'

interface Customer {
  id: string
  name: string
  nameKana: string
  phone: string
  email: string
  tags: string[]
  lastVisit: string | null
}

const mockCustomers: Customer[] = [
  {
    id: '1',
    name: '山田 花子',
    nameKana: 'ヤマダ ハナコ',
    phone: '090-1234-5678',
    email: 'hanako@example.com',
    tags: ['VIP', '常連'],
    lastVisit: '2026-03-08',
  },
  {
    id: '2',
    name: '佐藤 美咲',
    nameKana: 'サトウ ミサキ',
    phone: '080-9876-5432',
    email: 'misaki@example.com',
    tags: ['新規'],
    lastVisit: '2026-03-10',
  },
  {
    id: '3',
    name: '田中 太郎',
    nameKana: 'タナカ タロウ',
    phone: '070-1111-2222',
    email: 'taro@example.com',
    tags: [],
    lastVisit: '2026-02-20',
  },
  {
    id: '4',
    name: '鈴木 愛',
    nameKana: 'スズキ アイ',
    phone: '090-3333-4444',
    email: '',
    tags: ['要フォロー'],
    lastVisit: null,
  },
  {
    id: '5',
    name: '高橋 健太',
    nameKana: 'タカハシ ケンタ',
    phone: '080-5555-6666',
    email: 'kenta@example.com',
    tags: ['VIP'],
    lastVisit: '2026-03-05',
  },
]

const tagColors: Record<string, string> = {
  VIP: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  常連: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  新規: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  要フォロー: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

export default function CustomersPage() {
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return mockCustomers
    const q = search.toLowerCase()
    return mockCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.nameKana.toLowerCase().includes(q)
    )
  }, [search])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">顧客</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mockCustomers.length} 名の顧客
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>+ 新規顧客</Button>
      </div>

      {/* Search */}
      <Input
        placeholder="名前またはフリガナで検索..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-lg font-medium text-muted-foreground">
            顧客が見つかりません
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            検索条件を変更してください
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead className="hidden sm:table-cell">フリガナ</TableHead>
                <TableHead className="hidden md:table-cell">電話番号</TableHead>
                <TableHead className="hidden lg:table-cell">メール</TableHead>
                <TableHead>タグ</TableHead>
                <TableHead className="hidden sm:table-cell">最終来店</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="hover:underline"
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {customer.nameKana}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {customer.phone}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {customer.email || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {customer.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className={tagColors[tag] || ''}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {customer.lastVisit || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* New Customer Dialog */}
      <CustomerForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  )
}

"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type KaruteStatus = "DRAFT" | "REVIEW" | "APPROVED"

interface KaruteListItem {
  id: string
  date: string
  customerName: string
  staffName: string
  status: KaruteStatus
  entryCount: number
}

const statusConfig: Record<
  KaruteStatus,
  { label: string; className: string }
> = {
  DRAFT: {
    label: "下書き",
    className:
      "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  },
  REVIEW: {
    label: "確認中",
    className:
      "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800",
  },
  APPROVED: {
    label: "承認済",
    className:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800",
  },
}

const mockRecords: KaruteListItem[] = [
  {
    id: "k1",
    date: "2026-03-10",
    customerName: "山田 花子",
    staffName: "田中 太郎",
    status: "REVIEW",
    entryCount: 6,
  },
  {
    id: "k2",
    date: "2026-03-09",
    customerName: "鈴木 一郎",
    staffName: "佐藤 美咲",
    status: "APPROVED",
    entryCount: 4,
  },
  {
    id: "k3",
    date: "2026-03-08",
    customerName: "高橋 直美",
    staffName: "田中 太郎",
    status: "DRAFT",
    entryCount: 0,
  },
  {
    id: "k4",
    date: "2026-03-07",
    customerName: "佐々木 健太",
    staffName: "佐藤 美咲",
    status: "APPROVED",
    entryCount: 5,
  },
]

function StatusBadge({ status }: { status: KaruteStatus }) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  )
}

export default function KaruteListPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">カルテ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            施術記録の一覧と管理
          </p>
        </div>
        <Button>
          <Plus className="size-4" />
          新規カルテ
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日付</TableHead>
              <TableHead>顧客名</TableHead>
              <TableHead>担当</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">エントリー数</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockRecords.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="font-medium">{record.date}</TableCell>
                <TableCell>{record.customerName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {record.staffName}
                </TableCell>
                <TableCell>
                  <StatusBadge status={record.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {record.entryCount}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/karute/${record.id}`}>
                    <Button variant="ghost" size="xs">
                      <FileText className="size-3.5" />
                      表示
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

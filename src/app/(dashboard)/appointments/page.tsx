'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Plus, Calendar } from 'lucide-react'

type AppointmentStatus = '確定' | '仮予約' | 'キャンセル'

interface Appointment {
  id: string
  dateTime: string
  customerName: string
  service: string
  staff: string
  status: AppointmentStatus
}

const MOCK_APPOINTMENTS: Appointment[] = [
  {
    id: '1',
    dateTime: '2026-03-11 10:00',
    customerName: '田中 美咲',
    service: 'カット + カラー',
    staff: '山田 太郎',
    status: '確定',
  },
  {
    id: '2',
    dateTime: '2026-03-11 11:30',
    customerName: '佐藤 花子',
    service: 'トリートメント',
    staff: '鈴木 一郎',
    status: '確定',
  },
  {
    id: '3',
    dateTime: '2026-03-11 13:00',
    customerName: '高橋 健太',
    service: 'カット',
    staff: '山田 太郎',
    status: '仮予約',
  },
  {
    id: '4',
    dateTime: '2026-03-11 14:30',
    customerName: '渡辺 由美',
    service: 'パーマ + カット',
    staff: '佐々木 恵',
    status: '確定',
  },
  {
    id: '5',
    dateTime: '2026-03-12 10:00',
    customerName: '伊藤 翔',
    service: 'カラー',
    staff: '鈴木 一郎',
    status: 'キャンセル',
  },
  {
    id: '6',
    dateTime: '2026-03-12 11:00',
    customerName: '中村 さくら',
    service: 'ヘッドスパ + トリートメント',
    staff: '佐々木 恵',
    status: '仮予約',
  },
]

function getStatusVariant(
  status: AppointmentStatus
): 'default' | 'secondary' | 'destructive' {
  switch (status) {
    case '確定':
      return 'default'
    case '仮予約':
      return 'secondary'
    case 'キャンセル':
      return 'destructive'
  }
}

function getStatusClassName(status: AppointmentStatus): string {
  switch (status) {
    case '確定':
      return 'bg-green-500/15 text-green-700 dark:text-green-400'
    case '仮予約':
      return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
    case 'キャンセル':
      return ''
  }
}

export default function AppointmentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">予約</h1>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          新規予約
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日時</TableHead>
                <TableHead>顧客名</TableHead>
                <TableHead>施術内容</TableHead>
                <TableHead>担当者</TableHead>
                <TableHead>ステータス</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MOCK_APPOINTMENTS.map((apt) => (
                <TableRow key={apt.id}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {apt.dateTime}
                  </TableCell>
                  <TableCell>{apt.customerName}</TableCell>
                  <TableCell>{apt.service}</TableCell>
                  <TableCell>{apt.staff}</TableCell>
                  <TableCell>
                    <Badge
                      variant={getStatusVariant(apt.status)}
                      className={cn(getStatusClassName(apt.status))}
                    >
                      {apt.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

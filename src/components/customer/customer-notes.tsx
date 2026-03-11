'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface CustomerNotesProps {
  phone: string
  email: string
  notes: string
  tags: string[]
}

export function CustomerNotes({ phone, email, notes: initialNotes, tags }: CustomerNotesProps) {
  const [notes, setNotes] = useState(initialNotes)
  const [saved, setSaved] = useState(true)

  function handleNotesChange(value: string) {
    setNotes(value)
    setSaved(false)
  }

  function handleSave() {
    console.log('[CustomerNotes] Save:', notes)
    setSaved(true)
  }

  return (
    <div className="space-y-4">
      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">連絡先情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">電話番号</span>
            <span>{phone || '—'}</span>
          </div>
          <Separator />
          <div className="flex justify-between">
            <span className="text-muted-foreground">メール</span>
            <span>{email || '—'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Tags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">タグ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
            <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground">
              + 追加
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">メモ</CardTitle>
            {!saved && (
              <Button size="sm" onClick={handleSave}>保存</Button>
            )}
            {saved && notes !== initialNotes && (
              <span className="text-xs text-green-600">保存済み</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="お客様に関するメモ..."
            rows={4}
          />
        </CardContent>
      </Card>
    </div>
  )
}

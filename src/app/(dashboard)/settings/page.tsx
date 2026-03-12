'use client'

import { useState, useCallback } from 'react'
import { Settings, Save } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface SettingsState {
  // Profile
  organizationName: string
  businessType: string
  ownerName: string
  // AI Settings
  aiProvider: string
  aiModel: string
  recordingLanguage: string
  autoTranscribe: boolean
  autoClassify: boolean
  // Recording Settings
  audioQuality: string
  maxRecordingDuration: number
  // Notifications
  emailNotifications: boolean
  notificationEmail: string
}

const defaultSettings: SettingsState = {
  organizationName: '',
  businessType: '',
  ownerName: '',
  aiProvider: 'openai',
  aiModel: 'gpt-4o',
  recordingLanguage: 'ja',
  autoTranscribe: true,
  autoClassify: true,
  audioQuality: 'standard',
  maxRecordingDuration: 60,
  emailNotifications: false,
  notificationEmail: '',
}

function Toggle({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        checked ? 'bg-primary' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const updateSetting = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(() => {
    console.log('Settings saved:', settings)
  }, [settings])

  const handleExportData = useCallback(() => {
    console.log('Exporting all data...')
  }, [])

  const handleDeleteAllData = useCallback(() => {
    console.log('Deleting all data...')
    setDeleteDialogOpen(false)
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-2xl font-bold">設定</h1>
        </div>
        <Button onClick={handleSave} className="gap-2">
          <Save className="h-4 w-4" />
          保存
        </Button>
      </div>

      {/* 1. Profile */}
      <Card>
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
          <CardDescription>組織とオーナーの基本情報を設定します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="organizationName" className="text-sm font-medium">
              組織名
            </label>
            <Input
              id="organizationName"
              placeholder="例: サクラ美容院"
              value={settings.organizationName}
              onChange={(e) => updateSetting('organizationName', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="businessType" className="text-sm font-medium">
              業種
            </label>
            <Select
              value={settings.businessType}
              onValueChange={(value) => value && updateSetting('businessType', value)}
            >
              <SelectTrigger id="businessType">
                <SelectValue placeholder="業種を選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="salon">サロン</SelectItem>
                <SelectItem value="clinic">クリニック</SelectItem>
                <SelectItem value="seitaiin">整体院</SelectItem>
                <SelectItem value="other">その他</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="ownerName" className="text-sm font-medium">
              オーナー名
            </label>
            <Input
              id="ownerName"
              placeholder="例: 山田太郎"
              value={settings.ownerName}
              onChange={(e) => updateSetting('ownerName', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. AI Settings */}
      <Card>
        <CardHeader>
          <CardTitle>AI設定</CardTitle>
          <CardDescription>AI文字起こしと分類の設定を管理します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="aiProvider" className="text-sm font-medium">
              AIプロバイダー
            </label>
            <Select
              value={settings.aiProvider}
              onValueChange={(value) => value && updateSetting('aiProvider', value)}
            >
              <SelectTrigger id="aiProvider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="aiModel" className="text-sm font-medium">
              モデル
            </label>
            <Select
              value={settings.aiModel}
              onValueChange={(value) => value && updateSetting('aiModel', value)}
            >
              <SelectTrigger id="aiModel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="gpt-4o-mini">GPT-4o-mini</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="recordingLanguage" className="text-sm font-medium">
              録音言語
            </label>
            <Select
              value={settings.recordingLanguage}
              onValueChange={(value) => value && updateSetting('recordingLanguage', value)}
            >
              <SelectTrigger id="recordingLanguage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ja">日本語</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="auto">自動検出</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="autoTranscribe" className="text-sm font-medium">
                録音後に自動文字起こし
              </label>
              <p className="text-sm text-muted-foreground">
                録音完了後、自動的に文字起こしを開始します
              </p>
            </div>
            <Toggle
              id="autoTranscribe"
              checked={settings.autoTranscribe}
              onCheckedChange={(checked) => updateSetting('autoTranscribe', checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="autoClassify" className="text-sm font-medium">
                文字起こし後に自動分類
              </label>
              <p className="text-sm text-muted-foreground">
                文字起こし完了後、AIが自動的にカルテ項目を分類します
              </p>
            </div>
            <Toggle
              id="autoClassify"
              checked={settings.autoClassify}
              onCheckedChange={(checked) => updateSetting('autoClassify', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 3. Recording Settings */}
      <Card>
        <CardHeader>
          <CardTitle>録音設定</CardTitle>
          <CardDescription>音声録音の品質と制限を設定します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="audioQuality" className="text-sm font-medium">
              音声品質
            </label>
            <Select
              value={settings.audioQuality}
              onValueChange={(value) => value && updateSetting('audioQuality', value)}
            >
              <SelectTrigger id="audioQuality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">標準</SelectItem>
                <SelectItem value="high">高音質</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label htmlFor="maxRecordingDuration" className="text-sm font-medium">
              最大録音時間（分）
            </label>
            <Input
              id="maxRecordingDuration"
              type="number"
              min={1}
              max={180}
              value={settings.maxRecordingDuration}
              onChange={(e) =>
                updateSetting('maxRecordingDuration', parseInt(e.target.value, 10) || 60)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>通知</CardTitle>
          <CardDescription>メール通知の設定を管理します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="emailNotifications" className="text-sm font-medium">
                メール通知
              </label>
              <p className="text-sm text-muted-foreground">
                重要な更新をメールで受け取ります
              </p>
            </div>
            <Toggle
              id="emailNotifications"
              checked={settings.emailNotifications}
              onCheckedChange={(checked) => updateSetting('emailNotifications', checked)}
            />
          </div>

          {settings.emailNotifications && (
            <div className="space-y-2">
              <label htmlFor="notificationEmail" className="text-sm font-medium">
                通知先メールアドレス
              </label>
              <Input
                id="notificationEmail"
                type="email"
                placeholder="example@email.com"
                value={settings.notificationEmail}
                onChange={(e) => updateSetting('notificationEmail', e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Data Management */}
      <Card>
        <CardHeader>
          <CardTitle>データ管理</CardTitle>
          <CardDescription>データのエクスポートや削除を行います</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">データエクスポート</p>
              <p className="text-sm text-muted-foreground">
                すべてのカルテデータをエクスポートします
              </p>
            </div>
            <Button variant="outline" onClick={handleExportData}>
              エクスポート
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-destructive">データ削除</p>
              <p className="text-sm text-muted-foreground">
                すべてのデータを完全に削除します。この操作は取り消せません。
              </p>
            </div>
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogTrigger render={<Button variant="destructive" />}>
                すべて削除
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>本当にすべてのデータを削除しますか？</DialogTitle>
                  <DialogDescription>
                    この操作は取り消すことができません。すべてのカルテ、録音データ、顧客情報が完全に削除されます。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>
                    キャンセル
                  </DialogClose>
                  <Button variant="destructive" onClick={handleDeleteAllData}>
                    削除する
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

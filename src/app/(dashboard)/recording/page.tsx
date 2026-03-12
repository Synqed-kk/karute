"use client"

import { useCallback, useState } from "react"
import { Mic, Upload, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RecordingControls } from "@/components/recording"

const MOCK_CUSTOMERS = [
  { id: "1", name: "田中 太郎" },
  { id: "2", name: "佐藤 花子" },
  { id: "3", name: "鈴木 一郎" },
  { id: "4", name: "高橋 美咲" },
  { id: "5", name: "渡辺 健太" },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function RecordingPage() {
  const [selectedCustomer, setSelectedCustomer] = useState<string>("")
  const [completedBlob, setCompletedBlob] = useState<Blob | null>(null)

  const handleRecordingComplete = useCallback((blob: Blob) => {
    setCompletedBlob(blob)
  }, [])

  const handleUpload = () => {
    if (!completedBlob) return
    console.log("Upload placeholder:", {
      customerId: selectedCustomer,
      blobSize: completedBlob.size,
      blobType: completedBlob.type,
    })
  }

  const handleNewRecording = () => {
    setCompletedBlob(null)
  }

  return (
    <div className="flex flex-col items-center gap-8 pt-4">
      {/* Header */}
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">録音</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          施術中の会話を録音してカルテを自動作成
        </p>
      </div>

      {/* Customer Selector */}
      <div className="w-full max-w-xs">
        <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
          顧客を選択
        </label>
        <Select value={selectedCustomer} onValueChange={(v) => setSelectedCustomer(v ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="顧客を選択してください" />
          </SelectTrigger>
          <SelectContent>
            {MOCK_CUSTOMERS.map((customer) => (
              <SelectItem key={customer.id} value={customer.id}>
                {customer.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Recording Area */}
      <div className="flex w-full max-w-md flex-col items-center rounded-2xl border border-border/50 bg-card/50 px-8 py-12 backdrop-blur-sm">
        {completedBlob ? (
          /* Completion state */
          <div className="flex flex-col items-center gap-6">
            <div className="flex size-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle2 className="size-8 text-green-500" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium">録音完了</p>
              <p className="mt-1 text-sm text-muted-foreground">
                ファイルサイズ: {formatBytes(completedBlob.size)}
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleNewRecording}>
                <Mic className="size-4" data-icon="inline-start" />
                新しい録音
              </Button>
              <Button onClick={handleUpload} disabled={!selectedCustomer}>
                <Upload className="size-4" data-icon="inline-start" />
                アップロード
              </Button>
            </div>
            {!selectedCustomer && (
              <p className="text-xs text-muted-foreground">
                アップロードするには顧客を選択してください
              </p>
            )}
          </div>
        ) : (
          /* Recording interface */
          <RecordingControls onRecordingComplete={handleRecordingComplete} />
        )}
      </div>
    </div>
  )
}

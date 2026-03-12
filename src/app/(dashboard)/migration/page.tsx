'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
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
import { cn } from '@/lib/utils'
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react'

const STEPS = ['アップロード', 'マッピング', 'インポート'] as const

const DETECTED_COLUMNS = ['日付', '顧客名', '施術内容', '担当者', 'メモ']

const TARGET_FIELDS = [
  { value: '', label: '-- 選択してください --' },
  { value: 'date', label: '日付 (date)' },
  { value: 'customerName', label: '顧客名 (customerName)' },
  { value: 'treatment', label: '施術内容 (treatment)' },
  { value: 'staffName', label: '担当者 (staffName)' },
  { value: 'notes', label: 'メモ (notes)' },
]

const DEFAULT_MAPPING: Record<string, string> = {
  '日付': 'date',
  '顧客名': 'customerName',
  '施術内容': 'treatment',
  '担当者': 'staffName',
  'メモ': 'notes',
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MigrationPage() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>(DEFAULT_MAPPING)
  const [progress, setProgress] = useState(0)
  const [importComplete, setImportComplete] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalRows = 128

  const handleFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext === 'csv' || ext === 'xlsx') {
      setFile(f)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile) handleFile(droppedFile)
    },
    [handleFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0]
      if (selected) handleFile(selected)
    },
    [handleFile]
  )

  const handleMappingChange = useCallback(
    (column: string, value: string) => {
      setMapping((prev) => ({ ...prev, [column]: value }))
    },
    []
  )

  // Animate progress bar in step 3
  useEffect(() => {
    if (step !== 2) return
    setProgress(0)
    setImportComplete(false)

    const duration = 3000
    const interval = 50
    const increment = 100 / (duration / interval)
    let current = 0

    const timer = setInterval(() => {
      current += increment
      if (current >= 100) {
        current = 100
        clearInterval(timer)
        setImportComplete(true)
      }
      setProgress(Math.min(Math.round(current), 100))
    }, interval)

    return () => clearInterval(timer)
  }, [step])

  const processedCount = Math.round((progress / 100) * totalRows)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">データ移行</h1>
        <p className="mt-1 text-muted-foreground">
          既存のカルテデータをCSV/Excelファイルからインポートします
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
                i < step
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {i < step ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                'text-sm font-medium',
                i === step ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <ArrowRight className="mx-2 h-4 w-4 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 0 && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 transition-colors',
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              )}
            >
              {file ? (
                <>
                  <FileSpreadsheet className="h-12 w-12 text-primary" />
                  <div className="text-center">
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFile(null)}
                  >
                    ファイルを変更
                  </Button>
                </>
              ) : (
                <>
                  <Upload className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">
                      ファイルをドラッグ＆ドロップ
                    </p>
                    <p className="text-sm text-muted-foreground">
                      .csv または .xlsx ファイルに対応
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx"
                    className="hidden"
                    onChange={handleFileInput}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    ファイルを選択
                  </Button>
                </>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => setStep(1)}
                disabled={!file}
              >
                次へ
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Column Mapping */}
      {step === 1 && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              検出されたカラムを対応するフィールドにマッピングしてください。
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>検出カラム</TableHead>
                  <TableHead>マッピング先</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DETECTED_COLUMNS.map((col) => (
                  <TableRow key={col}>
                    <TableCell className="font-medium">{col}</TableCell>
                    <TableCell>
                      <select
                        value={mapping[col] || ''}
                        onChange={(e) =>
                          handleMappingChange(col, e.target.value)
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {TARGET_FIELDS.map((field) => (
                          <option key={field.value} value={field.value}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                戻る
              </Button>
              <Button onClick={() => setStep(2)}>
                インポート開始
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Import Progress */}
      {step === 2 && (
        <Card>
          <CardContent className="space-y-6 pt-6">
            {!importComplete ? (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="text-lg font-medium">インポート中...</p>
                  <p className="text-sm text-muted-foreground">
                    {processedCount} / {totalRows} 件処理中...
                  </p>
                </div>
                <div className="mx-auto max-w-md">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-100"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-center text-sm text-muted-foreground">
                    {progress}%
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-8">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
                <div className="text-center">
                  <p className="text-lg font-bold">
                    インポートが完了しました
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {totalRows} 件のレコードが正常にインポートされました
                  </p>
                </div>
                <Button asChild>
                  <a href="/dashboard">ダッシュボードへ</a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

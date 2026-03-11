'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Send, Sparkles, MessageCircle, Loader2 } from 'lucide-react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_PROMPTS = [
  '山田さんの最近のカルテ内容を教えて',
  '今月の来店数が多い顧客は？',
  '肩こりの施術で注意すべきことは？',
  '次回フォローが必要な顧客を教えて',
]

const MOCK_RESPONSES: Record<string, string> = {
  default:
    'ご質問ありがとうございます。現在、AIアシスタント機能は開発中です。近日中にカルテデータを活用した回答が可能になります。もう少々お待ちください。',
  カルテ:
    '山田太郎様の直近のカルテを確認しました。3月5日の施術では、肩甲骨周りの緊張が見られ、指圧とストレッチを中心に施術を行いました。次回は腰部のケアも併せて行うことをお勧めします。',
  来店:
    '今月の来店数上位の顧客は以下の通りです：\n1. 佐藤花子様 - 4回\n2. 田中一郎様 - 3回\n3. 鈴木美咲様 - 3回\n定期的にご来店いただいている顧客へのフォローアップをお勧めします。',
  肩こり:
    '肩こりの施術では以下の点にご注意ください：\n・僧帽筋上部の過度な圧迫を避ける\n・頸部の可動域を事前に確認する\n・施術後のセルフケア指導を忘れずに\n・症状が長期化している場合は医療機関への紹介も検討してください。',
  フォロー:
    '次回フォローが必要な顧客は3名です：\n1. 山田太郎様 - 前回から2週間経過、腰痛の経過確認が必要\n2. 高橋明美様 - 初回施術後のフォローアップ\n3. 渡辺健太様 - 定期メンテナンス時期（月1回ペース）',
}

function getMockResponse(message: string): string {
  for (const [keyword, response] of Object.entries(MOCK_RESPONSES)) {
    if (keyword !== 'default' && message.includes(keyword)) {
      return response
    }
  }
  return MOCK_RESPONSES.default
}

export default function AskAIPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Mock AI response with delay
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: getMockResponse(content),
    }

    setMessages((prev) => [...prev, assistantMessage])
    setIsLoading(false)
    inputRef.current?.focus()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handlePromptClick = (prompt: string) => {
    sendMessage(prompt)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">AI に聞く</h1>
            <p className="text-sm text-muted-foreground">
              カルテデータをもとにAIが回答します
            </p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <MessageCircle className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              何でもお聞きください
            </h2>
            <p className="mb-8 text-sm text-muted-foreground">
              カルテや顧客情報に関する質問にAIがお答えします
            </p>
            <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
              {SUGGESTED_PROMPTS.map((prompt, index) => (
                <Card
                  key={index}
                  className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
                  onClick={() => handlePromptClick(prompt)}
                >
                  <CardContent className="flex items-start gap-3 p-4">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary/60" />
                    <span className="text-sm leading-relaxed">{prompt}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    考え中...
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t bg-background px-6 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-center gap-2"
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="質問を入力してください..."
            disabled={isLoading}
            className="flex-1"
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}

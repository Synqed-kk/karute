import { NextRequest, NextResponse } from 'next/server'

// TODO: Implement real AI chat with customer context
// 1. Parse user intent
// 2. Query relevant customer/karute data
// 3. Build context prompt
// 4. Call OpenAI/Anthropic
// 5. Return response

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { message, context } = body as {
      message: string
      context?: string
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'メッセージが必要です' },
        { status: 400 }
      )
    }

    // Mock response for now
    return NextResponse.json({
      response:
        '申し訳ございませんが、現在この機能は開発中です。近日中にご利用いただけるようになります。',
    })
  } catch {
    return NextResponse.json(
      { error: 'リクエストの処理中にエラーが発生しました' },
      { status: 500 }
    )
  }
}

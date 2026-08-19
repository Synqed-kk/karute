// /{locale}/business — the Business index. It forwards to 今日の運営, which is
// canon's entry screen: the day board is what a store opens the morning on, and
// every other screen is something you go to from it (⚖ L-5).
import { redirect } from 'next/navigation'

export default async function BusinessIndex({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/business/today`)
}

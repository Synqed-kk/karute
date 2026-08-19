// /{locale}/business — the Business index. One screen exists, so it forwards
// there rather than shipping an empty landing page.
import { redirect } from 'next/navigation'

export default async function BusinessIndex({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/business/customers`)
}

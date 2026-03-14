import { SignupForm } from '@/components/signup-form'

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Karute</h1>
          <p className="text-muted-foreground mt-1 text-sm">Create your business account</p>
        </div>
        <SignupForm locale={locale} />
      </div>
    </div>
  )
}

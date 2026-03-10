import { Sidebar } from '@/components/layout/sidebar'
import { OrgProvider } from '@/components/providers/org-provider'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <OrgProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-6">{children}</div>
        </main>
      </div>
    </OrgProvider>
  )
}

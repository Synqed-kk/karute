export type StaffRole = 'owner' | 'admin' | 'staff'

export type Organization = {
  id: string
  name: string
  plan: 'free' | 'pro' | 'enterprise'
}

export type Staff = {
  id: string
  name: string
  role: StaffRole
}

export type OrgContextValue = {
  org: Organization
  staff: Staff
} | null

// THE one territory file that reaches core (DESIGN-PRACTICE-DOOR.md §2, §7).
// Explicit-tenant factory only; the tenant check runs BEFORE the client is built,
// so a login-path bug fails loud and never lists another business. The SDK client
// never leaves this file: callers get bound READ methods and nothing else.

import { newSynqedClient } from '@/lib/synqed/client'
import { practiceTenant } from './switch'

export class PracticeTenantMismatch extends Error {
  readonly businessId: string
  constructor(businessId: string) {
    super(`practice switch refused business ${businessId}`)
    this.name = 'PracticeTenantMismatch'
    this.businessId = businessId
  }
}

export type CoreClient = ReturnType<typeof newSynqedClient>
export type CoreReads = ReturnType<typeof readsOf>

export function clientFor(admitted: { businessId: string }): CoreReads {
  const tenant = practiceTenant()
  if (tenant === null) throw new Error('practice door called with the switch unset')
  if (admitted.businessId !== tenant) throw new PracticeTenantMismatch(admitted.businessId)
  return readsOf(newSynqedClient(tenant))
}

export function readsOf(client: CoreClient) {
  return {
    storesList: () => client.stores.list(),
    staffList: (o?: Parameters<CoreClient['staff']['list']>[0]) => client.staff.list(o),
    staffStoresList: () => client.staffStores.list(),
    answerSheet: (id: string) => client.permissions.answerSheet(id),
    menusList: (o?: Parameters<CoreClient['menus']['list']>[0]) => client.menus.list(o),
    customersList: (o?: Parameters<CoreClient['customers']['list']>[0]) => client.customers.list(o),
    customerVisits: (id: string) => client.customers.listVisits(id),
    appointmentsList: (o?: Parameters<CoreClient['appointments']['list']>[0]) => client.appointments.list(o),
    orgSettingsGet: () => client.orgSettings.get(),
    resourcesList: (o?: Parameters<CoreClient['resources']['list']>[0]) => client.resources.list(o),
  }
}

'use server'

import {
  getCustomerVisitHistory,
  type CustomerVisitHistory,
} from '@/lib/customers/visit-history'

/**
 * Client-callable entry point for a customer's QuickReserve visit + payment
 * history. The heavy lifting (QR resolve + fetch) is cached server-side.
 */
export async function loadCustomerVisitHistory(
  name: string,
  memberNumber: string | null,
): Promise<CustomerVisitHistory> {
  return getCustomerVisitHistory(name, memberNumber)
}

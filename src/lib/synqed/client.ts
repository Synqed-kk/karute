import { SynqedClient } from '@synqed/client'

const baseUrl = process.env.SYNQED_CORE_URL
const apiKey = process.env.SYNQED_API_KEY
const tenantId = process.env.SYNQED_TENANT_ID

if (!baseUrl || !apiKey || !tenantId) {
  throw new Error(
    'Missing SYNQED_CORE_URL, SYNQED_API_KEY, or SYNQED_TENANT_ID env vars'
  )
}

export const synqed = new SynqedClient({ baseUrl, apiKey, tenantId })

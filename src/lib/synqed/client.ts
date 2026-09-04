import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId, getCurrentAccessToken } from '@/lib/staff'

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers as Record<string, string>
}

class ActorSynqedClient extends SynqedClient {
  constructor(
    config: ConstructorParameters<typeof SynqedClient>[0],
    private readonly accessToken?: string,
  ) {
    super(config)
  }

  private withActorHeaders<T extends { headers?: HeadersInit }>(init?: T): T | undefined {
    if (!this.accessToken) return init
    return {
      ...init,
      headers: {
        ...headersToRecord(init?.headers),
        Authorization: `Bearer ${this.accessToken}`,
      },
    } as unknown as T
  }

  override fetch<T>(path: string, init?: RequestInit): Promise<T> {
    return super.fetch<T>(path, this.withActorHeaders(init))
  }

  override fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    return super.fetchRaw(path, this.withActorHeaders(init))
  }

  override fetchMultipart<T>(
    path: string,
    formData: FormData,
    init?: { headers?: Record<string, string> },
  ): Promise<T> {
    return super.fetchMultipart<T>(path, formData, this.withActorHeaders(init))
  }
}

/**
 * Creates a SynqedClient for an EXPLICIT business id. This is the tenancy seam:
 * the facade (Bearer path) passes the business resolved from the verified token,
 * NOT a cookie — so a mobile request is scoped to its own tenant deterministically.
 * Env vars are read lazily so module imports in build envs without runtime env
 * don't crash.
 */
export function newSynqedClient(businessId: string) {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
  }
  return new ActorSynqedClient({ baseUrl, apiKey, businessId })
}

/**
 * Creates a SynqedClient scoped to the current user's business.
 * Call this in server actions/routes — it reads the business ID from the
 * authenticated user's profile (cookie path).
 */
export async function getSynqedClient() {
  const [businessId, accessToken] = await Promise.all([
    getBusinessId(),
    getCurrentAccessToken(),
  ])
  return new ActorSynqedClient({ baseUrl: process.env.SYNQED_CORE_URL!, apiKey: process.env.SYNQED_CORE_API_KEY!, businessId }, accessToken)
}

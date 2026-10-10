/** ⚖ S116 round 5 (#1088) — an in-memory `recordings` bucket for the lease suites: storage's
 *  create-only refusal, each object's server-side created_at (`bucket.clock`), and one fault
 *  hook `onCall(op, key, n)` (n = how many calls of that op on that key so far, this one included). */
export type BucketObj = { body: string; createdAt: number }
export type Fault = '500' | 'throw' | null
export const bucket = {
  objects: new Map<string, BucketObj>(),
  clock: { now: 0 },
  onCall: null as null | ((op: 'create' | 'upsert' | 'download' | 'info', key: string, n: number) => Fault | Promise<Fault>),
}
const counts = new Map<string, number>()
export const bucketTick = () => new Promise<void>((resolve) => setImmediate(resolve))
export function resetBucket() {
  bucket.objects.clear()
  counts.clear()
  bucket.onCall = null
}
async function fault(op: 'create' | 'upsert' | 'download' | 'info', key: string): Promise<Fault> {
  const k = `${op} ${key}`
  const n = (counts.get(k) ?? 0) + 1
  counts.set(k, n)
  return bucket.onCall ? await bucket.onCall(op, key, n) : null
}
const err = (statusCode: string, message: string) => ({ statusCode, message })
export const bucketService = {
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string, body: string, opts: { upsert: boolean }) => {
          await bucketTick()
          const f = await fault(opts.upsert ? 'upsert' : 'create', key)
          if (f === 'throw') throw new Error('storage threw')
          if (f === '500') return { error: err('500', 'Internal') }
          const had = bucket.objects.get(key)
          if (!opts.upsert && had) return { error: err('409', 'The resource already exists') }
          bucket.objects.set(key, { body, createdAt: had?.createdAt ?? bucket.clock.now })
          return { error: null }
        },
        download: async (key: string) => {
          await bucketTick()
          const f = await fault('download', key)
          if (f === 'throw') throw new Error('storage threw')
          if (f === '500') return { data: null, error: err('500', 'Internal') }
          const had = bucket.objects.get(key)
          if (!had) return { data: null, error: err('404', 'Object not found') }
          return { data: { text: async () => had.body }, error: null }
        },
        info: async (key: string) => {
          await bucketTick()
          const f = await fault('info', key)
          if (f === 'throw') throw new Error('storage threw')
          if (f === '500') return { data: null, error: err('500', 'Internal') }
          const had = bucket.objects.get(key)
          if (!had) return { data: null, error: err('404', 'Object not found') }
          return { data: { name: key, createdAt: new Date(had.createdAt).toISOString() }, error: null }
        },
      }),
    },
  }),
}

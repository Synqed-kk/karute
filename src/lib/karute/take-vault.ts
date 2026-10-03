'use client'

/**
 * THE SEALED COPY (build 32, PR-B Wn — RULINGS-S80 R-S80-1, S81 R-S81-5/-6/-10,
 * S82 R-S82-1/-3). Imported by take-store.ts ONLY (pinned).
 *
 * What it holds: a durable copy of a take's meta and segment rows, written
 * just before a human settle (確認する, or the settle at a save) deletes a
 * phone recording the server does not hold at least the phone's copy of. Its
 * one job is that such a recording is never lost: the live delete runs only
 * after this copy has COMMITTED with `durability: 'strict'`.
 *
 * Why a separate database, not a third store in `karute_takes`: a new store
 * needs a version bump there, and take-store's `openDb` resolves null on
 * `onblocked` — one tab still holding version 1 would switch every live take
 * read off. A separate database never touches the live one; its store names
 * differ from `takes`/`segments` too.
 *
 * Nothing live reads it: no list, offer, upload, drain, sweep, TTL or logout
 * wipe opens this database, and no reader is exported. It only grows — an
 * existing seq is replaced only by a strictly LARGER blob, never deleted,
 * cleared or shrunk; the meta is the latest copy's. Its future reader (S-10,
 * the rescue) MUST check `ownerUid` before reading anything: the sealed meta
 * keeps the owner and the transcript of a shared device's takes.
 */

const VAULT_DB = 'karute_sealed_copies'
const VAULT_TAKES = 'sealed_metas'
const VAULT_SEGMENTS = 'sealed_segments'

type SealedSegment = { takeId: string; seq: number; blob: Blob }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** The one accepted connection — dropped on close or versionchange. */
let cached: IDBDatabase | null = null

/** Open (or reuse) the vault. null = unavailable: an error, a `VersionError`
 *  (an older build after a later version), `onblocked`, or a throw — every one
 *  fails closed. A success that arrives after this attempt was answered
 *  (`onblocked`) or abandoned (the caller's deadline) closes THAT connection
 *  only; a cached connection a later copy is using is never touched. */
function openVault(abandoned: () => boolean): Promise<IDBDatabase | null> {
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve) => {
    let answered = false
    const answer = (db: IDBDatabase | null) => {
      answered = true
      resolve(db)
    }
    try {
      const open = indexedDB.open(VAULT_DB, 1)
      open.onupgradeneeded = () => {
        const db = open.result
        if (!db.objectStoreNames.contains(VAULT_TAKES))
          db.createObjectStore(VAULT_TAKES, { keyPath: 'takeId' })
        if (!db.objectStoreNames.contains(VAULT_SEGMENTS))
          db.createObjectStore(VAULT_SEGMENTS, { keyPath: ['takeId', 'seq'] })
      }
      open.onsuccess = () => {
        const db = open.result
        if (answered || abandoned()) {
          db.close()
          return answer(null)
        }
        if (cached) {
          db.close()
          return answer(cached)
        }
        db.onversionchange = () => {
          if (cached === db) cached = null
          db.close()
        }
        db.onclose = () => {
          if (cached === db) cached = null
        }
        cached = db
        answer(db)
      }
      open.onerror = () => answer(null)
      open.onblocked = () => answer(null)
    } catch {
      answer(null)
    }
  })
}

/** Copy one take into the vault in ONE strict readwrite transaction and answer
 *  what the vault now HOLDS for it, `{seq → Blob.size}` — only after that
 *  transaction's `complete`. false (and a `console.error` naming why) on: the
 *  vault unavailable · a transaction that does not report `durability` exactly
 *  `'strict'` (absent, `'default'`, `'relaxed'` …) · a throw anywhere · an
 *  abort or error · `deadlineMs` passing first (it covers the open AND the
 *  copy). Never rejects. A copy that lands after its deadline only grows the
 *  vault; its caller has already answered false and deleted nothing. */
export function sealTakeCopy(
  meta: { takeId: string },
  segments: readonly SealedSegment[],
  deadlineMs: number,
): Promise<Map<number, number> | false> {
  return new Promise((resolve) => {
    let done = false
    const end = (held: Map<number, number> | false, why?: unknown) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (!held) console.error('[take-vault] sealed copy did not finish — nothing deleted:', why)
      resolve(held)
    }
    const timer = setTimeout(() => end(false, 'deadline'), deadlineMs)
    const copy = async () => {
      const db = await openVault(() => done)
      if (!db) return end(false, 'vault unavailable')
      if (done) return
      const tx = db.transaction([VAULT_TAKES, VAULT_SEGMENTS], 'readwrite', { durability: 'strict' })
      const durability: unknown = tx.durability
      if (durability !== 'strict') return end(false, `durability ${String(durability)}`)
      const committed = new Promise<boolean>((res) => {
        tx.oncomplete = () => res(true)
        tx.onabort = () => res(false)
        tx.onerror = () => res(false)
      })
      const store = tx.objectStore(VAULT_SEGMENTS)
      for (const s of segments) {
        const had = (await req(store.get([s.takeId, s.seq]))) as SealedSegment | undefined
        if (!had || s.blob.size > had.blob.size)
          await req(store.put({ takeId: s.takeId, seq: s.seq, blob: s.blob }))
      }
      await req(tx.objectStore(VAULT_TAKES).put(meta))
      // R-S87-4: this take's rows only — the key range over [takeId, seq].
      const rows = (await req(store.getAll(IDBKeyRange.bound([meta.takeId, 0], [meta.takeId, []])))) as SealedSegment[]
      const held = new Map(rows.filter((r) => r.takeId === meta.takeId).map((r) => [r.seq, r.blob.size]))
      if (!(await committed)) return end(false, 'copy aborted')
      end(held)
    }
    copy().catch((err) => end(false, err))
  })
}

// Strict input schemas for the recording-flow facade writes (packet 08 §Build 3
// F8 hygiene). EVERY new schema carries .max() caps from birth: the transcript
// via the single-source MAX_STORED_TRANSCRIPT_CHARS (ai-safety.ts), and every
// short field its own generous ceiling. `.strict()` rejects unknown keys so a
// spoofed field never rides through to synqed-core.

import { z } from 'zod'
import { MAX_STORED_TRANSCRIPT_CHARS } from '@/lib/ai-safety'

export { MAX_STORED_TRANSCRIPT_CHARS }

// Ids / short scalars. 200 is generous for a cuid/uuid + any prefix.
const MAX_ID_CHARS = 200
const MAX_NAME_CHARS = 200
const MAX_DATE_CHARS = 40
const MAX_LOCALE_CHARS = 10
const MAX_SUMMARY_CHARS = 20_000
const MAX_ENTRY_CONTENT_CHARS = 8_000
const MAX_QUOTE_CHARS = 8_000
const MAX_CATEGORY_CHARS = 40
const MAX_STORAGE_PATH_CHARS = 300
// Shared by every door that takes a recorder container (the session mint, the
// upload-url mint, finalize) — it only BOUNDS the string; the real validation is
// the closed MIME map in key-grammar.ts.
const MAX_MIME_CHARS = 100

// ── Consent grant (§Smaller pre-rulings) ────────────────────────────────────
// method is a CLOSED enum; policy_version is SERVER-pinned (never accepted here).
export const ConsentGrantSchema = z
  .object({ method: z.enum(['VERBAL', 'WRITTEN']) })
  .strict()

// ── Recording-session mint (Decision 3) ─────────────────────────────────────
// BORN RESERVED (capture pipeline PR2, fix round 10). The recorder knows its own
// take id and the container it negotiated at start(), so the row that starts a
// recording is created WITH audio_storage_path already set — one atomic create
// instead of a create followed by the mint's update, which is the only place two
// concurrent client-named mints on one unbound row could race.
//
// Both fields stay OPTIONAL at the field level: an absent pair is the walk-in
// body this route has always minted, byte for byte. THE FIELD-PAIR RULE mirrors
// UploadUrlMintSchema's below — a take id with no container has no extension to
// compose, and a container with no take id names nothing — and it is re-checked
// in the shared core (startRecordingSessionWithClient), because the WEB door
// runs no zod at all. takeId is `.uuid()` for the same reason as the mint's: a
// shape that fails zod is bad_input one fence earlier, and an uppercase uuid
// that passes zod's case-INSENSITIVE check is still refused by the case-exact
// grammar in composeTakeKey.
export const SessionMintSchema = z
  .object({
    customerId: z.string().max(MAX_ID_CHARS).nullish(),
    appointmentId: z.string().max(MAX_ID_CHARS).nullish(),
    takeId: z.string().uuid().nullish(),
    mimeType: z.string().max(MAX_MIME_CHARS).nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.takeId) === Boolean(v.mimeType), {
    message: 'takeId and mimeType must be sent together',
    path: ['mimeType'],
  })

// ── Upload-url mint (capture pipeline PR2) ──────────────────────────────────
// ALL THREE fields optional at the FIELD level: an absent body is the
// server-named take this route has always minted. mimeType's cap only BOUNDS
// the string — the real validation is server-side (composeTakeKey: the closed
// MIME map), so a well-formed-but-wrong container is refused by the fence, not
// by zod. takeId is `.uuid()` (fix round 8, matching recordingSessionId below
// and finalize's own): zod's shape check is case-INSENSITIVE, so an uppercase
// uuid still reaches composeTakeKey and is refused there, bad_take_id, by the
// grammar's case-exact TAKE_UUID — anything that fails zod's OWN shape is
// bad_input, one fence earlier.
//
// recordingSessionId (fix round 4) is the row the mint RESERVES this take's key
// on. It is a uuid for the same reason the finalize schema's is: it rides into a
// core URL PATH unencoded (the SDK's recordings.get), so a free string there is
// a request-forgery surface.
//
// THE FIELD-PAIR RULE (fix round 7): takeId and recordingSessionId arrive
// together or not at all. A take id with no session is a mint that used to
// CREATE a row — the branch fix round 7 deleted, because a lost response left
// the caller unable to name the row it had just made. A session with no take id
// is a row the mint would silently ignore. Both are bad_input, and the rule
// lives HERE because this schema is the one parse both doors run.
//
// mimeType JOINS THE RULE (capture pipeline PR4, packet rider): it is the third
// field of the same one act, and SessionMintSchema above has always paired it.
// A named take with no container falls back to `.webm` inside composeTakeKey,
// so a phone that negotiated audio/mp4 and forgot to say so would have its take
// keyed `.webm` — the wrong extension on the object the whole pipeline now
// reads, and a mismatch the finalize (which composes the key from the SAME pair
// it was given) cannot see. Refusing the half-body is one 400 at the door
// instead. A container with no take id names nothing, exactly as before.
export const UploadUrlMintSchema = z
  .object({
    takeId: z.string().uuid().nullish(),
    mimeType: z.string().max(MAX_MIME_CHARS).nullish(),
    recordingSessionId: z.string().uuid().nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.takeId) === Boolean(v.recordingSessionId), {
    message: 'takeId and recordingSessionId must be sent together',
    path: ['recordingSessionId'],
  })
  .refine((v) => Boolean(v.takeId) === Boolean(v.mimeType), {
    message: 'takeId and mimeType must be sent together',
    path: ['mimeType'],
  })

// ── Take finalize (capture pipeline PR2) — "this take is complete on storage".
// takeId + mimeType compose the SAME key the mint composed (never a path from
// the client). byteLength is checked against the object storage actually holds,
// so a finalize cannot claim a take the bucket does not have.
//
// This schema is the WEB door's only validation too: finalizeTakeWithClient
// parses with it on its first line, so both doors refuse the same bodies.
// Both ids are uuids — a uuid IS the ceiling this file's .max() law asks for,
// and recordingSessionId rides into a core URL PATH unencoded (the SDK's
// recordings.get), so a free string there is a request-forgery surface.
// recordingSessionId is REQUIRED as of fix round 4: the mint reserves the take's
// key on that row before any byte can exist, so a finalize that cannot name its
// row is a finalize for a take this server never bound.
// The two numbers get ceilings for the same reason: durationSeconds is WRITTEN
// onto the core row, and a take of zero bytes is not a take at all.
const MAX_TAKE_SECONDS = 86_400 // 24h — no real take comes close.
const MAX_TAKE_BYTES = 2 * 1024 * 1024 * 1024
export const FinalizeTakeSchema = z
  .object({
    takeId: z.string().uuid(),
    mimeType: z.string().max(MAX_MIME_CHARS),
    durationSeconds: z.number().finite().min(0).max(MAX_TAKE_SECONDS),
    byteLength: z.number().int().min(1).max(MAX_TAKE_BYTES),
    recordingSessionId: z.string().uuid(),
  })
  .strict()

// ── Transcribe (Decision 2) — a STORAGE PATH, never a URL. ───────────────────
export const TranscribeSchema = z
  .object({
    path: z.string().max(MAX_STORAGE_PATH_CHARS),
    locale: z.string().max(MAX_LOCALE_CHARS).optional(),
  })
  .strict()

// ── Extract / summarize compute (Decision 2) ────────────────────────────────
export const AiComputeSchema = z
  .object({
    transcript: z.string().max(MAX_STORED_TRANSCRIPT_CHARS),
    locale: z.string().max(MAX_LOCALE_CHARS).optional(),
    customerName: z.string().max(MAX_NAME_CHARS).nullish(),
    sessionDate: z.string().max(MAX_DATE_CHARS).nullish(),
  })
  .strict()

// ── Suggestions (Decision 1) — transcript/summary/entries best-effort. ───────
export const SuggestionsSchema = z
  .object({
    transcript: z.string().max(MAX_STORED_TRANSCRIPT_CHARS).nullish(),
    summary: z.string().max(MAX_SUMMARY_CHARS).nullish(),
    entries: z
      .array(
        z.object({
          category: z.string().max(MAX_CATEGORY_CHARS),
          title: z.string().max(MAX_ENTRY_CONTENT_CHARS),
        }),
      )
      .max(200)
      .optional(),
    locale: z.string().max(MAX_LOCALE_CHARS).optional(),
  })
  .strict()

// ── Chat (design-parity F-9b) — the AI相談 send. ────────────────────────────
// message cap mirrors the web route's 4000; history is strictly typed here
// (the web route filters loose entries instead) and the total-chars budget is
// applied AFTER parse via capHistory. context_hint stays unknown — the shared
// parseContextHint is the validator (invalid shapes degrade to null, never 400).
const MAX_CHAT_MESSAGE_CHARS = 4000
// Per-turn ceiling only guards against a pathological single turn; the real
// bound is capHistory's MAX_HISTORY_CHARS total budget applied after parse.
const MAX_CHAT_TURN_CHARS = 20_000
export const ChatSchema = z
  .object({
    message: z
      .string()
      .max(MAX_CHAT_MESSAGE_CHARS)
      .refine((s) => s.trim().length > 0, 'message must not be blank'),
    locale: z.string().max(MAX_LOCALE_CHARS).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(MAX_CHAT_TURN_CHARS),
        }),
      )
      .max(200)
      .optional(),
    context_hint: z.unknown().optional(),
  })
  .strict()

// ── Save (Decision 3) — SaveKaruteInput, F8-capped from birth. ───────────────
const SaveEntrySchema = z.object({
  category: z.string().max(MAX_CATEGORY_CHARS),
  content: z.string().max(MAX_ENTRY_CONTENT_CHARS),
  sourceQuote: z.string().max(MAX_QUOTE_CHARS).nullish(),
  confidenceScore: z.number(),
  // Provenance (edit-layer Wave 1 fix round): true for a staff-edited or
  // hand-added entry — forwarded to createOrUpdateKaruteRecord's is_manual
  // mapping. Undefined/false keeps an entry AI, same as before this field
  // existed.
  isManual: z.boolean().optional(),
})

// ── Manual karute create (PHONEWIRE-2A) — the ＋新規カルテ dialog's write.
// staffId IS accepted (unlike RecordingJobEnqueueSchema below): the dialog's
// dropdown can name ANOTHER staff, re-checked against records.delete at the
// route. The STORE is never a field — .strict() 400s a storeId/store_id key
// (⚖ STORE ISOLATION LAW). durationMinutes/sessionDate stay as loose as the
// dialog sends them (0 and '' are its "unset", normalised to null in the
// shared body) — this door must not be stricter than web.
export const ManualKaruteCreateSchema = z
  .object({
    customerId: z.string().max(MAX_ID_CHARS),
    staffId: z.string().max(MAX_ID_CHARS),
    sessionDate: z.string().max(MAX_DATE_CHARS),
    durationMinutes: z.number(),
    service: z.string().max(MAX_NAME_CHARS),
  })
  .strict()

export const SaveKaruteSchema = z
  .object({
    customerId: z.string().max(MAX_ID_CHARS),
    appointmentId: z.string().max(MAX_ID_CHARS).nullish(),
    recordingSessionId: z.string().max(MAX_ID_CHARS).nullish(),
    transcript: z.string().max(MAX_STORED_TRANSCRIPT_CHARS),
    summary: z.string().max(MAX_SUMMARY_CHARS),
    entries: z.array(SaveEntrySchema).max(500),
    // Explicit collision-entries intent for createOrUpdateKaruteRecord
    // (edit-layer Wave 1 fix round) — 'replace' always sends entries on a
    // recording_session_id collision (the converge-on-staff contract);
    // 'fill-if-empty' omits them when the existing record already has some
    // (an automatic resend with nothing newer to say). DEFAULT 'replace':
    // old thin clients in the field send no flag, and 'replace' is the
    // pre-existing, known-safe behavior.
    entriesMode: z.enum(['replace', 'fill-if-empty']).default('replace'),
    outcome: z
      .object({
        status: z.enum(['success', 'no_deal', 'pending', 'revisit']),
        reason: z
          .enum(['budget', 'considering', 'mismatch', 'follow_up', 'other'])
          .nullish(),
        isFirstVisit: z.boolean().optional(),
      })
      .strict()
      .nullish(),
    duration: z.number().nullish(),
  })
  .strict()

// ── Recording job enqueue (packet 22 B2) — mirrors EnqueueRecordingJobInput.
// staffId/store_id are SERVER-resolved (never accepted from the client, same
// #452 posture as the session mint's selfStaffId); outcome reuses the SAME
// vocabulary/shape as SaveKaruteSchema's outcome above.
export const RecordingJobEnqueueSchema = z
  .object({
    recordingSessionId: z.string().max(MAX_ID_CHARS),
    customerId: z.string().max(MAX_ID_CHARS),
    audioPath: z.string().max(MAX_STORAGE_PATH_CHARS),
    appointmentId: z.string().max(MAX_ID_CHARS).nullish(),
    locale: z.string().max(MAX_LOCALE_CHARS).optional(),
    durationSeconds: z.number().optional(),
    outcome: z
      .object({
        status: z.enum(['success', 'no_deal', 'pending', 'revisit']),
        reason: z
          .enum(['budget', 'considering', 'mismatch', 'follow_up', 'other'])
          .nullish(),
        isFirstVisit: z.boolean().optional(),
      })
      .strict()
      .nullish(),
  })
  .strict()

// ── Discard transcript write (PHONEWIRE-2C) — the two shapes the client relay
// (lib/recording/discard-transcript.ts) actually sends, as ONE union so the door
// can never be ambiguous about which it got: both members are `.strict()`, so a
// body carrying BOTH `transcript` and `audioPath` matches neither and is a 400
// rather than a silent pick. Same posture as the discard receipt beside it.
export const DiscardTranscriptWriteSchema = z.union([
  // `review` origin: the words are already in hand, nothing is transcribed.
  z
    .object({
      recordingSessionId: z.string().max(MAX_ID_CHARS),
      transcript: z.string().max(MAX_STORED_TRANSCRIPT_CHARS),
      durationSeconds: z.number().finite().min(0),
    })
    .strict(),
  // `recorder` origin: a STORAGE PATH, never a URL — the tenant prefix is
  // re-proved server-side against the Bearer identity's own business.
  z
    .object({
      recordingSessionId: z.string().max(MAX_ID_CHARS),
      audioPath: z.string().max(MAX_STORAGE_PATH_CHARS),
      durationSeconds: z.number().finite().min(0),
      locale: z.string().max(MAX_LOCALE_CHARS),
    })
    .strict(),
])

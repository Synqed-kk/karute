// Masking for free text that may leave Karute (log lines, error reports).
// Import-free on purpose: it runs in node, edge and the browser (moved
// byte-for-byte from src/lib/app-api/errors.ts, item 102 / PR-A0b).

// A canonical UUID (8-4-4-4-12 hex) is exempt from the blob rule below — ids
// are already on the log line via other fields, and a UUID's hyphens don't
// break a blob-charset run the way they'd need to for the rule to skip it
// on its own. Ids are not secrets, so a storage key built from ids (e.g.
// `app_<uuid>_<uuid>.webm`) must survive too — the test below now matches a
// UUID anywhere in the run, not just a run that equals one exactly.
export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** NFKC (full-width ＠ → @, full-width digits and dashes → ASCII, NBSP and
 *  the ideographic space → space), then every format character (zero-width
 *  space / joiner, bidi controls, BOM: Unicode Cf) removed, so a disguised
 *  email or phone number has its plain shape before any rule runs
 *  (R-S112-5 F1). */
export function normaliseText(s: string): string {
  return s.normalize('NFKC').replace(/\p{Cf}+/gu, '')
}

/** The email rule (bounded quantifiers — no nested-quantifier ambiguity,
 *  paired with `preBound`). Runs on the normalised string BEFORE the
 *  non-ASCII rule, so a non-ASCII neighbour can no longer split it. The
 *  second alternative (R-S113-6) is `local@` + a domain holding non-ASCII
 *  writing (`tanaka.hanako@例え.jp`): the whole address is `<email>`, so the
 *  local part never leaves beside a masked domain. */
const EMAIL_RE =
  /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}|[A-Za-z0-9.-]{0,255}[^\x00-\x7F](?:[^\x00-\x7F]|[A-Za-z0-9.-]){0,254})/g

/** A phone/card separator (R-S113-5 D1/D2, R-S113-6 F-S113-1): space, tab,
 *  newline, carriage return · `+ _ , /` · dot · every dash (ASCII hyphen,
 *  U+2010–U+2015, minus U+2212, small/full-width hyphen-minus U+FE63/U+FF0D,
 *  katakana prolonged mark U+30FC as an IME types it, hyphen bullet U+2043,
 *  heavy minus U+2796, katakana double hyphen U+30A0) · parentheses · the
 *  middle dot U+30FB and the wave dashes U+301C / U+FF5E (and `~`, the form
 *  U+FF5E takes after NFKC) · R-S115-10 N2: the box-drawing lines U+2500 /
 *  U+2501 (typed as a dash), the ideographic comma U+3001 and its half-width
 *  form U+FF64, the half-width prolonged mark U+FF70 (NFKC folds these two
 *  into U+3001 / U+30FC; listed for the guard's first pass, which can see
 *  them raw). NOT の (a word: 「090の1234の5678」 still leaves its digits).
 *  What 、 newly eats: a 、-list holding 10-16 digits in all
 *  (「100、200、300、400」 → `<phone>`), as `,` already did; a date or a
 *  short list (「2026ー10ー09」, 「1、2、3」) is unchanged.
 *  A gap between digit groups is 1–3 of these.
 *  NOT a colon (R-S113-10): `127.0.0.1:3100` is an address and port. */
const PHONE_SEP = ' \\t\\n\\r+_,/~.\\-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u30FC()\u30FB\u301C\uFF5E\u2043\u2796\u30A0\u2500\u2501\u3001\uFF64\uFF70'
/** THE version string (R-S112-8 (a), R-S113-4 (b), R-S113-5 D3) — the one
 *  definition, used wherever digits are judged: digit groups of at most 5
 *  digits joined by single dots, 2+ groups, the WHOLE separated run
 *  (`120.0.2210.91`, `17.1`, `0.9.1`); the first group is `0` or does not
 *  start with `0` (every Japanese domestic phone does), and at most ONE group
 *  has 4+ digits (a phone or card has two). A version is not a number, so the
 *  phone/digit rule skips it. A run with any other separator or a leading `+`
 *  is not a version. Known trade: a 4-digit build AND a 4-digit patch
 *  (`130.0.6723.1000`) is not a version (the field drops at spaced
 *  positions). Unbroken groups ≤ 5 digits never reach the 10–16 or 7+ rules. */
const VERSION_RE = /^(?:0|[1-9]\d{0,4})(?:\.\d{1,5})+$/
export function isVersion(s: string): boolean {
  return VERSION_RE.test(s) && (s.match(/\d{4,}/g) ?? []).length <= 1
}
const DIGIT_RUN = new RegExp(`\\+?\\d+(?:[${PHONE_SEP}]{1,3}\\d+)*`, 'g')
/** Separator-tolerant phone / card rule (R-S112-5 F1 (3)): a digit run
 *  broken by separators (gaps of 1–3 PHONE_SEP characters; an optional
 *  leading `+`, e.g. +81) is masked when
 *  any stretch of it with at most five separators holds 10–16 digits.
 *  Unbroken runs are left to the 7+-digit rule; a run that is a version
 *  string in full (isVersion) is left whole; a leading date (DATE_PREFIX) is
 *  kept and the rest judged. */
/** A run that starts with a date (R-S113-6 NIT) — the one definition: the
 *  date is kept and the REST of the run is judged (`2024-10-08 12:34:56`
 *  stays; `2024-10-08 090-1234-5678` keeps the date, masks the phone). Not
 *  followed by a digit, and the month (01–12) and day (01–31) must be real
 *  (R-S113-12), so `2012-34-5678` and `2012-34-56 7890 1234` are judged whole. */
const DATE_PREFIX = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?!\d)/
export function maskPhones(s: string): string {
  return s.replace(DIGIT_RUN, (m) => {
    const date = DATE_PREFIX.exec(m)
    if (date) return date[0] + maskPhones(m.slice(date[0].length))
    if (isVersion(m)) return m
    const groups = (m.match(/\d+/g) ?? []).map((g) => g.length)
    for (let i = 0; i < groups.length; i++) {
      let sum = groups[i]
      for (let j = i + 1; j < groups.length && j - i <= 5; j++) {
        sum += groups[j]
        if (sum >= 10 && sum <= 16) return '<phone>'
        if (sum > 16) break
      }
    }
    return m
  })
}

/** Masking order (fix round 4): URL (origin+path, query stripped — a
 *  case-insensitive scheme) → non-ASCII free text (upstream messages carry
 *  no ASCII-pattern secrets the later rules would catch, so this runs right
 *  after the URL step, before anything else can see it) → Bearer token →
 *  labelled credentials (LABELLED_CRED_RE: the label list is there, label
 *  `:`/`=` value — this also catches a secret embedded in a URL
 *  PATH, which the URL step above only strips the QUERY of) → JWT → email
 *  (bounded quantifiers — no nested/overlapping-quantifier ambiguity, paired
 *  with `preBound` above) → opaque 32+-char blobs (base64 / API keys; a run
 *  CONTAINING a canonical UUID is exempt, not just a run that equals one) →
 *  hyphenated JP phone numbers (`090-1234-5678`) → 7+-digit runs (phone/
 *  card-like strings).
 *
 *  R-S112-5 F1 (item 102 fix batch 1) puts three steps in front: NFKC +
 *  format-character removal (normaliseText) → URL → EMAIL → the
 *  separator-tolerant phone/card rule (maskPhones) → then the non-ASCII rule
 *  and the rest in the order above.
 *
 *  Fix round 3: the labelled-credential pattern has no leading `\b` so
 *  prefixed/camelCase names (access_token, clientSecret) are caught as
 *  substrings too; this accepts over-masking an innocent word that merely
 *  ends in a label (e.g. `monkey: banana`).
 *
 *  The blob charset deliberately drops `/` from the base64 alphabet
 *  (`+/_=-`) despite it being a legal base64 char: a URL's kept origin+path
 *  (the step right above) is itself very often a 32+-char run of letters,
 *  digits and `/` between dots, and matching against it there re-mangled an
 *  already-correctly-masked URL into fragments (found empirically running
 *  the pinned URL test in fix round 2). Base64url secrets — the far more
 *  common real-world shape, precisely because it's URL-safe — use `-`/`_`
 *  instead of `+`/`/` and are unaffected. */
export function maskSensitive(s: string): string {
  let out = normaliseText(s)
  out = out.replace(/https?:\/\/\S+/gi, (m) => {
    try {
      const u = new URL(m)
      return u.origin + u.pathname
    } catch {
      return '<url>'
    }
  })
  out = out.replace(EMAIL_RE, '<email>')
  out = maskPhones(out)
  out = out.replace(/[^\x00-\x7F]+/g, '<text>')
  out = out.replace(AUTH_HEADER_RE, 'Authorization: <redacted>')
  out = out.replace(BEARER_RE, 'Bearer <token>')
  out = out.replace(LABELLED_CRED_RE, '<label>=<redacted>')
  out = out.replace(JWT_RE, '<jwt>')
  // after the JWT rule, so `token eyJ…` stays `<jwt>` on errors.ts log lines
  out = out.replace(SCHEME_CRED_RE, '$1 <token>')
  out = out.replace(/[A-Za-z0-9+_=-]{32,}/g, (m) => (UUID_RE.test(m) ? m : '<blob>'))
  out = out.replace(/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/g, '<phone>')
  out = out.replace(/\d{7,}/g, '<digits>')
  return out
}

/** Defense-in-depth against a huge text (perf, errors.ts fix round 2, MUST-2):
 *  bound to 2000 chars BEFORE any masking regex runs. ONE definition:
 *  errors.ts and the Sentry exit both import this. The cut must never leave
 *  a PARTIAL shape the masks can no longer see (Greptile #1159 G2: a cut
 *  email 「tanaka.ha」 is not an email; 「090 1234」 is not a phone):
 *  (1) the cut word is dropped — back to the last whitespace (scanned
 *  backward, bounded to 2000 steps; no shape but a phone, a label or
 *  `Bearer`/`Authorization` spans whitespace, and those three mask their
 *  stub or keep no value); with no whitespace at all, the trailing run of
 *  ASCII / full-width ASCII / format characters is dropped (an email, key or
 *  token is made of those; a non-ASCII email domain keeps its `local@`, which
 *  the email rule still masks whole); then (2) the trailing run of digits,
 *  whitespace and phone separators is dropped (a phone cut between groups).
 *  What this eats: on a text over 2000 chars only, the cut word plus any
 *  trailing numbers and separators before it (「… step 3 of 5」); a 2000+
 *  char text with no whitespace keeps only its non-ASCII head.
 *  R-S115-1 S2: the cut text is NORMALISED (normaliseText: NFKC + format
 *  characters out) before the tail scan, so a look-alike (one-dot leader
 *  U+2024, small comma U+FE50, math-bold letters and digits) is judged in
 *  its plain form; a cut that splits an astral character drops the lone high
 *  surrogate first. NFKC can lengthen text (ligatures, ㍿), so the
 *  normalised text is bounded again. What this changes elsewhere: on a text
 *  over 2000 chars only, the exit's first guard pass sees the NFKC form (as
 *  maskSensitive always did), and an ideographic space now counts as the
 *  whitespace the cut word is dropped back to. */
const BOUND = 2000
const CUT_WORD_TAIL = /[\x21-\x7E\uFF01-\uFF5E\p{Cf}]+$/u
/** R-S115-1 N2: the trailing run starts at a separator or whitespace, or at a
 *  digit that follows one (or the start): a SEPARATE run (a phone cut between
 *  groups). The last digits of a complete word kept before the cut word
 *  (a 32-char key ending in `6`) are never stripped.
 *  R-S115-10 SF1: written WITHOUT a lookbehind (this module loads on every
 *  page through instrumentation-client.ts; Safari / WKWebView before 16.4
 *  cannot parse one and the page would never hydrate). A digit after a
 *  separator needs no lookbehind: the separator before it starts the same
 *  run one place earlier, so only a digit at the START is a second case.
 *  client-regex-safari15.test.ts keeps every client-loaded module free of
 *  regex features newer than Safari 15. */
const CUT_SEP = `\\s\\p{Cf}${PHONE_SEP}`
const CUT_DIGIT = '0-9\uFF10-\uFF19'
const CUT_PHONE_TAIL = new RegExp(`(?:^[${CUT_DIGIT}]|[${CUT_SEP}])[${CUT_DIGIT}${CUT_SEP}]*$`, 'u')
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/
function sliceToBound(t: string): string {
  const c = t.slice(0, BOUND)
  return LONE_HIGH_SURROGATE.test(c) ? c.slice(0, -1) : c
}
export function preBound(s: string): string {
  if (s.length <= BOUND) return s
  const cut = sliceToBound(normaliseText(sliceToBound(s)))
  let i = cut.length - 1
  while (i >= 0 && !/\s/.test(cut[i])) i--
  const kept = i >= 0 ? cut.slice(0, i) : cut.replace(CUT_WORD_TAIL, '')
  return kept.replace(CUT_PHONE_TAIL, '')
}

const PCT_NON_ASCII_RUN = /(%[89A-Fa-f][0-9A-Fa-f])+/g

/** Every run of `%XX` codes, a code's `25` re-encodings folded in
 *  (`%25E7`, `%25252525E7`): what replaces them when decoding fails. */
const PCT_RUN = /(%(?:25)*[0-9A-Fa-f]{2})+/g

/** One `%XX` code with its `%25` re-encodings folded in: its byte. */
const PCT_CODE = /%(?:25)*([0-9A-Fa-f]{2})/g

/** One maximal `%XX` run (R-S115-10 SF3), decoded on its own: every code to
 *  its byte however deep its `%25` layers go (`%25252540` → `@`); ASCII
 *  bytes always decode; each run of non-ASCII bytes decodes as UTF-8 or, when
 *  it is not valid UTF-8, becomes `[enc]`. */
function decodeRun(run: string): string {
  const bytes = Array.from(run.matchAll(PCT_CODE), (m) => parseInt(m[1], 16))
  let out = ''
  let i = 0
  while (i < bytes.length) {
    if (bytes[i] < 0x80) {
      out += String.fromCharCode(bytes[i++])
      continue
    }
    let j = i
    while (j < bytes.length && bytes[j] >= 0x80) j++
    const utf8 = bytes.slice(i, j).map((b) => `%${b.toString(16)}`).join('')
    try {
      out += decodeURIComponent(utf8)
    } catch {
      out += '[enc]'
    }
    i = j
  }
  return out
}

/** THE text decode (R-S115-1 N1) — one definition, used by the Sentry
 *  exit's masked() and the errors.ts server log line (message and, since
 *  R-S115-15, err.name). Runs on BOUNDED text (after preBound): `%40` → `@`,
 *  then rounds of: normalise (normaliseText, so a full-width ％ U+FF05 or a
 *  small ﹪ U+FE6A is a `%` when the decode looks, R-S115-15) and bound again
 *  (preBound: NFKC can lengthen), then EACH maximal `%XX` run decoded on its
 *  own (decodeRun; R-S115-10 SF3: one stray `%` or one bad run no longer turns
 *  every decode off). Rounds repeat until the text is stable (a decoded
 *  `%25%33%44` is `%3D`, decoded again to `=`; one round per full
 *  re-encoding). A guard of 8 rounds: a full re-encoding triples the length,
 *  so a 2000-character text holds at most six of one character (seven is
 *  2,187 characters); a run still left after 8 rounds becomes `[enc]`.
 *  Length: decoding a code never lengthens; the `[enc]` marker (5 characters)
 *  can replace a lone 3-character code (`%FF`), so the result is at most 5/3
 *  of the bound (3,334 characters); masked() cuts to n and errors.ts caps
 *  each field after this. */
export function decodeText(bound: string): string {
  let cur = bound.split('%40').join('@')
  for (let round = 0; round < 8; round++) {
    const next = preBound(normaliseText(cur)).replace(PCT_RUN, decodeRun)
    if (next === cur) return cur
    cur = next
  }
  return cur.replace(PCT_RUN, '[enc]')
}

/** The Sentry exit's `masked(n)` (item 102 § 2.0; R-S113-6 F-S113-2): bound
 *  (preBound) → decodeText (normalised, then `%40`→`@`, each `%XX` run decoded
 *  on its own until stable, a run that is not valid UTF-8 becomes `[enc]`) → the content guard →
 *  maskSensitive → non-ASCII runs → encoded non-ASCII runs → the guard again
 *  (masks) → cut to n. A text position MASKS, so the decoded-and-masked text
 *  is what leaves. A non-string, an empty result or a value whose only
 *  content was masked → undefined (the field is omitted). */
export function masked(v: unknown, n: number): string | undefined {
  if (typeof v !== 'string') return undefined
  // the guard also runs first, so a blob is judged whole before the masks
  // below cut it into fragments
  let s = guardContent(decodeText(preBound(v)))
  s = maskSensitive(s)
  s = s.replace(/[^\x00-\x7F]+/g, '[non-ascii]')
  s = s.replace(PCT_NON_ASCII_RUN, '[non-ascii]')
  s = guardContent(s)
  if (onlyMasked(s)) return undefined
  s = s.slice(0, n)
  return s.length > 0 ? s : undefined
}

// ---- the content guard (item 102 fix batch 1; R-S112-6 S2, R-S112-7) --------
// The LAST step of every string the Sentry exit lets out. At shape positions
// (path · token · spaced · transaction name · frame file) a hit DROPS the
// field (R-S101-11); at text positions (the masked pipeline) a hit is MASKED.

/** `Authorization:` or `authorization=` (R-S113-6 NIT) and everything after it. */
const AUTH_HEADER_RE = /\bAuthorization\s*[:=].*$/gim
/** A credential-looking value (R-S113-6 F-S113-4) — the one definition:
 *  `Basic` and `Token` mask only when followed by one, so 「Invalid Refresh
 *  Token: Refresh Token Not Found」 or 「Token expired」 keep their meaning. */
const CRED_VALUE = /[A-Za-z0-9+/=._-]{16,}/
const SCHEME_CRED_RE = new RegExp(`\\b(Basic|Token)\\s+${CRED_VALUE.source}`, 'gi')
/** THE labelled-credential rule (Greptile #1159 G1) — the one definition,
 *  used by maskSensitive (text: masks) AND guardOne (every shape position:
 *  token · path and frame file per segment · spaced · transaction name · iso ·
 *  content-type — a hit drops the field). The shape, in order:
 *  (1) a label word, no leading `\b` (access_token / clientSecret / dbPass /
 *  userPin / code_verifier match too). Vocabulary (R-S115-1 S1, R-S115-15):
 *  token · api key · key · secret · pass, password, passwd, passcode,
 *  passphrase · pwd · pw · psw · auth, authorization · session ·
 *  credential(s) · pin · verifier (PKCE `code_verifier`) · otp · one-time code
 *  (`one_time_code`, `one-time-code`, `oneTimeCode`).
 *  (2) at most ONE suffix from a closed list, with an optional `_` or `-`
 *  (R-S115-10 SF4): hash · code · digest · id · value · confirm, confirmation
 *  · plain · raw · old · new · current (`token_hash=`, `pinCode=`,
 *  `session_id=`). Never an open identifier tail, so `keyboard=`,
 *  `authenticated=true`, `tokenizer:`, `sessionStorage:` are kept.
 *  (3) optionally an index `[0]`, `[]` or a closing bracket, quoted or not
 *  (`user[password]=`, `user['password']=`, `user["password"]=`).
 *  (4) optionally any number of backslashes, then optionally a closing quote
 *  `"` `'` or `&quot;` (a JSON key `"password":`, a JSON body inside a string
 *  at any nesting depth `\"password\":`, `\\\"password\\\":`, an
 *  HTML-escaped one `&quot;password&quot;:`).
 *  (5) `:` or `=`, spaces around it allowed, then the value, the first form
 *  that matches: an escaped-quoted value — k backslashes and a quote, read to
 *  the next quote with exactly k backslashes before it (a back-reference; a
 *  backslash run before a quote with MORE backslashes, or before any other
 *  character, is part of the value: `\"hunt er \n x\"`, any nesting depth);
 *  an `&quot;`-quoted value to the next `&quot;`; a `"`-quoted value to its
 *  closing quote, `\x` inside it part of it; a `'`-quoted value; else a bare
 *  value up to a space, `&` or a quote. Each quoted form is a run of disjoint
 *  tokens (no backtracking ambiguity); an unclosed quoted form falls back to
 *  the bare value.
 *  What it also eats (masked in text, the field dropped at shape positions):
 *  a word that merely ENDS in a label before `:`/`=` (`bypass=`, `compass:`,
 *  `oauth=`, `OAuth: …`, `spin=`, `chopin:`, `monkey:banana`, `monkey_id=42`,
 *  `spinCode=3`, `PIN_CODE: invalid length`, `totp=`); real sentences with a
 *  label then `:`/`=` (`session: expired`, `invalid token: expired`,
 *  `missing env key: X`); the suffixes also eat `keyCode:`, `keyId=`,
 *  `key_id=`, `tokenId=`, `authCode=`, `keyValue:`, `keyHash=`, `pin_new=`,
 *  and a bracket before `=` (`map[key]=`, `key[0]=`, `filter[key]=name`,
 *  `filter["key"]=name`); `authId=undefined` and `secret_value: null` lose
 *  their value. Still leaves: any other suffix (`password1=`, `passwordStr=`,
 *  `pinNumber=`, `token_b64=`, `tokenString=`, `secretData=`), a dotted one
 *  (`key.value=`), a nested bracket (`user[password][0]=`), a quote written
 *  as `\u0022` or `&#34;`, and the rest named in the sentry-exit.ts header.
 *  A label with no `:`/`=` after it is kept (`Auth session missing!`,
 *  `/api/auth/session`, `pinned`, `passthrough`). */
export const LABELLED_CRED_RE =
  /(?:token|api[-_]?key|key|secret|pass(?:word|wd|code|phrase)?|pwd|pw|psw|auth(?:orization)?|session|credentials?|pin|verifier|otp|one[-_]?time[-_]?code)(?:[-_]?(?:hash|code|digest|id|value|confirm(?:ation)?|plain|raw|old|new|current))?(?:\[\d{0,3}\]|["']?\])?\\*(?:["']|&quot;)?\s*[:=]\s*(?:(\\+)"(?:[^"\\]|\\+(?=[^"\\])|\1\\+")*\1"|&quot;(?:[^&]|&(?!quot;))*&quot;|"(?:[^"\\]|\\[\s\S])*"|'[^']*'|\\?['"]?[^\s&'"]+)/gi
/** `Bearer` masks whatever follows it (unchanged). */
const BEARER_RE = /\bBearer\s+\S+/gi
/** THE JWT rule (R-S115-1 N4) — one definition, used by maskSensitive and
 *  guardOne. No leading `\b`, so a JWT glued to a word (`wordeyJ…`) is still
 *  caught; the header segment needs 10+ characters after `eyJ` (every real
 *  JWT header is longer), so a code name such as `keyJson.a.b` is kept. It
 *  still eats a name holding `eyJ` + 10 letters and two dotted parts
 *  (`monkeyJumpingAround.a.b`). */
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const B64_RUN = /[A-Za-z0-9+/=_-]{24,}/g
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_ALL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** R-S112-7: base64-looking = 24+ chars of the class, holding an upper-case
 *  letter, a lower-case letter AND a digit, and neither a UUID nor pure hex. */
export function base64Looking(run: string): boolean {
  return (
    run.length >= 24 && /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run) &&
    !UUID_EXACT.test(run) && !/^[0-9A-Fa-f]+$/.test(run)
  )
}

/** The digit rules with every canonical UUID left whole. */
function digitsOutsideUuids(s: string): string {
  const rule = (x: string) => maskUnbrokenDigits(maskPhones(x))
  let out = ''
  let last = 0
  for (const m of s.matchAll(UUID_ALL)) {
    out += rule(s.slice(last, m.index)) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + rule(s.slice(last))
}

/** An unbroken run of 10+ digits (the F1 rule with zero separators, NO upper
 *  bound: R-S113-4 (a)) — unless the hex-and-digit run around it is an id or
 *  hash: exactly one of HEX_ID_LENGTHS long AND holding a letter (a span id,
 *  a trace id, a commit SHA, a digest; R-S113-6). Any other hex-and-digit run
 *  (`deadbeef0901…`) is judged by the digit rule. UUIDs are left whole by
 *  digitsOutsideUuids. */
const HEX_OR_DIGIT_RUN = /[0-9A-Fa-f]+/g
/** The id and hash lengths (16, 20, 32, 40, 64) — the one definition. */
const HEX_ID_LENGTHS: ReadonlySet<number> = new Set([16, 20, 32, 40, 64])
function maskUnbrokenDigits(s: string): string {
  return s.replace(HEX_OR_DIGIT_RUN, (m) =>
    HEX_ID_LENGTHS.has(m.length) && /[A-Fa-f]/.test(m) ? m : m.replace(/\d{10,}/g, '<digits>'),
  )
}

function guardOne(s: string): string {
  let out = s.replace(AUTH_HEADER_RE, 'Authorization: <redacted>')
  out = out.replace(BEARER_RE, (m) => `${m.split(/\s/)[0]} <token>`)
  out = out.replace(LABELLED_CRED_RE, '<label>=<redacted>')
  out = out.replace(SCHEME_CRED_RE, '$1 <token>')
  out = out.replace(JWT_RE, '<jwt>')
  out = out.replace(B64_RUN, (m) => (base64Looking(m) ? '<blob>' : m))
  return digitsOutsideUuids(out)
}

/** guardContent(s): masks 10-16-digit runs with up to five separators and
 *  every unbroken 10+-digit run unless inside an id or hash (the F1 rule),
 *  base64-looking runs, a JWT, `Bearer <x>`, a labelled credential
 *  (LABELLED_CRED_RE), `Basic|Token <CRED_VALUE>` and everything after
 *  `Authorization:`. `perSegment` (path and frame-file positions): the rule
 *  runs on each `/`-separated segment, never across the whole path. */
export function guardContent(s: string, perSegment = false): string {
  return perSegment ? s.split('/').map(guardOne).join('/') : guardOne(s)
}

/** True when guardContent would change the value (a shape position drops it). */
export function guardHits(s: string, perSegment = false): boolean {
  return guardContent(s, perSegment) !== s
}

/** Stable percent-decoding: at most 3 rounds of decodeURIComponent until the
 *  value stops changing. A decode failure, or a value still changing after 3
 *  rounds, is null (the caller drops the field). */
export function pctDecode(s: string): string | null {
  let cur = s
  for (let i = 0; i < 3; i++) {
    let next: string
    try {
      next = decodeURIComponent(cur)
    } catch {
      return null
    }
    if (next === cur) return cur
    cur = next
  }
  try {
    return decodeURIComponent(cur) === cur ? cur : null
  } catch {
    return null
  }
}

/** True when nothing but masks, markers and punctuation is left. */
function onlyMasked(s: string): boolean {
  return !/[A-Za-z0-9]/.test(s.replace(/<[a-z]+>|\[non-ascii\]|\[enc\]/g, ''))
}

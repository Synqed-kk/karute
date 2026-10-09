// Plants shared by the mask-sensitive and Sentry-exit canaries (item 102 fix batch 1).

// R-S112-5 F1: every disguised form from the attack's a1 list. Each must lose
// its digits and its local part. Built from parts so no full literal sits here.
const LOCAL = ['tanaka', 'hanako'].join('.')
export const F1_FORMS: string[] = [
  `invalid email ${LOCAL}\uFF20gmail.com`,
  `bad ${LOCAL}\u200B@gmail.com`,
  'call 090 1234 5678',
  'tel +81-90-1234-5678',
  'tel +81 90 1234 5678',
  'tel (090)1234-5678',
  'tel 090.1234-5678',
  'tel 090 1234.5678',
  'tel 03 1234 5678',
  'customerphone090-1234-5678x',
  'tel 090\u20101234\u20105678',
  '090\uFF0D1234\uFF0D5678',
  '090\u30FC1234\u30FC5678',
  'Key (phone)=(090 1234 5678) already exists',
  'card 4111 1111 1111 1111',
  'tel \uFF10\uFF19\uFF10 \uFF11\uFF12\uFF13\uFF14 \uFF15\uFF16\uFF17\uFF18',
]

// A dots-only phone: it passed as a version under R-S112-8 (a); since
// R-S113-4 (b) / R-S113-5 D3 (zero-padded first group, two 4+ groups) it is
// masked like every other form.
export const VERSION_SHAPED_PHONE = 'tel 090.1234.5678'

// N8 plants (R-S112-6 S2 riders): phone, a 32-char mixed key, a JWT, a
// 200-char Base64 blob, Bearer text and query strings. Joined from parts.
export const PHONE_SP = ['090', '4321', '8765'].join(' ')
export const PHONE_HY = ['090', '4321', '8765'].join('-')
export const KEY32 = ['sk_live_', 'Zq8Wv3Xn5Ty7Ub9Rm2Lp4Kd6'].join('')
export const JWT = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiI5ODc2NTQzMjEwIn0', 'Qm9vbS1zaWduYXR1cmUtMTIzNDU2Nzg5MGFi'].join('.')
export const BLOB200 = Buffer.from(Array.from({ length: 150 }, (_, i) => (i * 53 + 7) % 256)).toString('base64')
export const FW_MAIL = ['sato.yui', 'example.com'].join('＠')

// Round 3 (R-S115-1 S1): every labelled-credential form the delta read found
// leaking. Each takes the planted secret (assembled by the caller) and must
// lose it at text positions and drop at shape positions.
export const LABEL_FORMS: ((secret: string) => string)[] = [
  (x) => `pass=${x}`, (x) => `pass: ${x}`, (x) => `pass = ${x}`, (x) => `passwd=${x}`,
  (x) => `pwd=${x}`, (x) => `pw=${x}`, (x) => `psw=${x}`, (x) => `passcode=${x}`,
  (x) => `passphrase: ${x}`, (x) => `auth=${x}`, (x) => `authorization=${x}`, (x) => `session=${x}`,
  (x) => `sessionid=${x}`, (x) => `session_id=${x}`, (x) => `credential=${x}`, (x) => `credentials=${x}`,
  (x) => `PIN=${x}`, (x) => `Cookie: session=${x}`, (x) => `{"password":"${x}"}`, (x) => `{"pwd": "${x}"}`,
  (x) => `'passwd': '${x}'`, (x) => `password="a ${x}"`, (x) => `dbPass=${x}`, (x) => `userPin:${x}`,
]

// Round 3 (R-S115-1 S2): NFKC look-alikes cut by preBound at 2000 after
// Japanese text with no whitespace. Math-bold letters and digits are astral
// (two code units), so a cut can also split one.
const mathBold = (s: string, base: number, first: string) =>
  [...s].map((c) => String.fromCodePoint(base + c.charCodeAt(0) - first.charCodeAt(0))).join('')
export const S2_CUT_SHAPES: [string, string][] = [
  ['U+2024-separated phone', ['090', '1234', '5678'].join('\u2024')],
  ['U+FE50-separated phone', ['090', '1234', '5678'].join('\uFE50')],
  ['math-bold-letter email', [mathBold('tanaka', 0x1d41a, 'a'), mathBold('hanako', 0x1d41a, 'a')].join('.') + '@example.com'],
  ['math-bold-digit phone', ['090', '1234', '5678'].map((g) => mathBold(g, 0x1d7ce, '0')).join('-')],
]
/** What is left once every marker is taken out: no letter or digit may be. */
export const residue = (s: string) => s.replace(/<[a-z]+>|\[non-ascii\]|\[enc\]/g, '').replace(/[^A-Za-z0-9]/g, '')

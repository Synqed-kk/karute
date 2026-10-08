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

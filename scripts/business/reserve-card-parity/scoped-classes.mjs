// The class names that open the rules of a set of CSS blocks — used by run.mjs to name the SCOPED blocks in
// PARITY.md from the blocks themselves, so the emitted line cannot drift when a scoped block is added or removed.
// Pure: no fs, no git. Input: block texts (as Reserve wrote them, i.e. after the `.member-ground ` strip), in css order.
// Output: the leading `.name` of every selector (pseudo-classes / pseudo-elements dropped), deduped, first-seen order.
// At-rule headers (@media …) are skipped; their nested rules are still read. A selector not opening with a class adds nothing.
export function scopedClasses(blocks) {
  const out = []
  for (const block of blocks) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, ' ')
    for (const [, raw] of css.matchAll(/([^{};]*)\{/g)) {
      const header = raw.trim()
      if (!header || header.startsWith('@')) continue
      // split on top-level commas only (a comma inside :is(…) belongs to one selector)
      const sels = ['']
      let depth = 0
      for (const c of header) {
        if (c === '(') depth++
        else if (c === ')') depth--
        if (c === ',' && !depth) sels.push('')
        else sels[sels.length - 1] += c
      }
      for (const sel of sels) {
        const m = sel.trim().match(/^\.(-?[_a-zA-Z][\w-]*)/)
        if (m && !out.includes(`.${m[1]}`)) out.push(`.${m[1]}`)
      }
    }
  }
  return out
}

// 1–9 as words, else the number — for "Reserve keeps these <N> idioms global".
export function countWord(n) {
  const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
  return Number.isInteger(n) && n >= 1 && n <= 9 ? WORDS[n - 1] : String(n)
}

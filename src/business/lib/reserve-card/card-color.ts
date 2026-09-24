// The port's colour boundary — Business code, not a Reserve port. Reserve's satinVars resolves a non-hex CSS
// colour (OKLCH, a name) through a canvas, which exists only in the browser, so the server and the browser
// would compute different --satin-* values for it. Only a strict #RRGGBB crosses into the satin math; anything
// else counts as absent, which is the path Reserve already takes for a tenant with no colour.
const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/** A card / brand colour as the satin math may take it: `#RRGGBB` → uppercase; anything else → null. */
export function normalizeCardColor(v: unknown): string | null {
  return typeof v === "string" && HEX6.test(v) ? v.toUpperCase() : null;
}

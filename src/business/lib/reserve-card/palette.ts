// The curated 12 Reserve card colours (W/CARD-LOOK-HANDOVER.json; names = JP-COPY-A1-FINAL palette.01–12).
// Business code, not a Reserve port: Reserve does not know the palette. The picker offers these and nothing else.
import { normalizeCardColor } from "./card-color";

export const PALETTE: ReadonlyArray<{ order: number; name: string; hex: string }> = [
  { order: 1, name: "紺", hex: "#1C2247" },
  { order: 2, name: "藍", hex: "#00304C" },
  { order: 3, name: "深緑", hex: "#1F3D33" },
  { order: 4, name: "松葉色", hex: "#2D4722" },
  { order: 5, name: "墨", hex: "#26282B" },
  { order: 6, name: "焦茶", hex: "#4A2E22" },
  { order: 7, name: "えんじ", hex: "#6B1F2B" },
  { order: 8, name: "紫紺", hex: "#3B2A4F" },
  { order: 9, name: "生成り", hex: "#EDE6D6" },
  { order: 10, name: "白", hex: "#F2F4F3" },
  { order: 11, name: "桜", hex: "#F1D9DC" },
  { order: 12, name: "空色", hex: "#D7E6F2" },
];

// Every value is exactly what the colour boundary would store (contract §6: stored = rendered = palette, byte for byte).
for (const c of PALETTE) if (normalizeCardColor(c.hex) !== c.hex) throw new Error(`palette: ${c.hex} is not a stored #RRGGBB`);

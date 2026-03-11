/**
 * Client-side karute export utilities.
 *
 * - `exportKarutePDF`  opens a print-ready window (browser print dialog).
 * - `exportKaruteText` downloads a plain-text .txt file via Blob + anchor.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KaruteExportEntry {
  category: string;
  content: string;
  originalQuote: string | null;
}

export interface KaruteExportData {
  customerName: string;
  staffName: string;
  date: string;
  aiSummary: string | null;
  entries: KaruteExportEntry[];
}

// ---------------------------------------------------------------------------
// Category label mapping (EntryCategory enum -> Japanese)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  SYMPTOM: "症状",
  TREATMENT: "施術",
  BODY_AREA: "部位",
  PREFERENCE: "希望",
  LIFESTYLE: "生活習慣",
  NEXT_VISIT: "次回予約",
  PRODUCT: "商品",
  OTHER: "その他",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters to prevent XSS in the print window. */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Group entries by category, preserving insertion order. */
function groupByCategory(
  entries: KaruteExportEntry[],
): Map<string, KaruteExportEntry[]> {
  const map = new Map<string, KaruteExportEntry[]>();
  for (const entry of entries) {
    const group = map.get(entry.category);
    if (group) {
      group.push(entry);
    } else {
      map.set(entry.category, [entry]);
    }
  }
  return map;
}

/** Format a Date as YYYY-MM-DD HH:mm */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// PDF (print) export
// ---------------------------------------------------------------------------

/**
 * Opens a styled print-preview window containing the karute record and
 * triggers the browser's native print dialog (Save as PDF supported).
 */
export function exportKarutePDF(data: KaruteExportData): void {
  const grouped = groupByCategory(data.entries);
  const now = formatTimestamp(new Date());

  // Build category sections
  let sectionsHtml = "";
  for (const [category, entries] of grouped) {
    sectionsHtml += `
      <div class="category-section">
        <h3 class="category-title">${esc(categoryLabel(category))}</h3>
        ${entries
          .map(
            (e) => `
          <div class="entry">
            <p class="entry-content">${esc(e.content)}</p>
            ${
              e.originalQuote
                ? `<p class="entry-quote">「${esc(e.originalQuote)}」</p>`
                : ""
            }
          </div>`,
          )
          .join("")}
      </div>`;
  }

  // Build AI summary section
  const summaryHtml = data.aiSummary
    ? `
      <div class="ai-summary">
        <h3 class="ai-summary-title">AI サマリー</h3>
        <p>${esc(data.aiSummary)}</p>
      </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>カルテ記録 – ${esc(data.customerName)}</title>
  <style>
    /* ---------- Reset & base ---------- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body {
      font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic",
        "Meiryo", sans-serif;
      color: #1a1a1a;
      background: #fff;
      padding: 40px 48px;
      line-height: 1.7;
      font-size: 14px;
    }

    /* ---------- Header ---------- */
    .header {
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    .header-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    }
    .header-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      font-size: 13px;
      color: #444;
    }
    .header-meta span { white-space: nowrap; }
    .meta-label {
      font-weight: 600;
      color: #1a1a1a;
      margin-right: 4px;
    }

    /* ---------- AI Summary ---------- */
    .ai-summary {
      background: #f7f7f5;
      border: 1px solid #e0ddd8;
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    .ai-summary-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #555;
      letter-spacing: 0.04em;
    }
    .ai-summary p {
      font-size: 13px;
      color: #333;
      white-space: pre-wrap;
    }

    /* ---------- Category sections ---------- */
    .category-section {
      margin-bottom: 22px;
    }
    .category-title {
      font-size: 15px;
      font-weight: 700;
      color: #1a1a1a;
      padding: 6px 0;
      margin-bottom: 8px;
      border-bottom: 1px solid #d0d0d0;
      letter-spacing: 0.04em;
    }
    .entry {
      padding: 6px 0 6px 12px;
      border-left: 3px solid #d0d0d0;
      margin-bottom: 10px;
    }
    .entry-content {
      font-size: 14px;
      color: #1a1a1a;
    }
    .entry-quote {
      font-size: 12px;
      color: #777;
      margin-top: 4px;
      font-style: italic;
    }

    /* ---------- Footer ---------- */
    .footer {
      margin-top: 36px;
      padding-top: 12px;
      border-top: 1px solid #d0d0d0;
      font-size: 11px;
      color: #999;
      text-align: right;
    }

    /* ---------- Print adjustments ---------- */
    @media print {
      body { padding: 20px 24px; }
      .category-section { break-inside: avoid; }
      .ai-summary { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="header-title">カルテ記録</h1>
    <div class="header-meta">
      <span><span class="meta-label">日付:</span>${esc(data.date)}</span>
      <span><span class="meta-label">顧客名:</span>${esc(data.customerName)}</span>
      <span><span class="meta-label">担当:</span>${esc(data.staffName)}</span>
    </div>
  </div>

  ${summaryHtml}

  ${sectionsHtml}

  <div class="footer">出力日時: ${esc(now)}</div>

  <script>
    window.addEventListener("afterprint", function () { window.close(); });
    window.print();
  </script>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    // Pop-up blocked — fall back to alerting the user.
    // eslint-disable-next-line no-alert
    alert("ポップアップがブロックされました。ブラウザの設定を確認してください。");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}

// ---------------------------------------------------------------------------
// Plain-text export
// ---------------------------------------------------------------------------

/**
 * Generates a plain-text karute record and triggers a .txt download.
 */
export function exportKaruteText(data: KaruteExportData): void {
  const sep = "─".repeat(40);
  const now = formatTimestamp(new Date());
  const grouped = groupByCategory(data.entries);

  const lines: string[] = [
    "カルテ記録",
    sep,
    `日付: ${data.date}`,
    `顧客名: ${data.customerName}`,
    `担当: ${data.staffName}`,
    sep,
  ];

  if (data.aiSummary) {
    lines.push("", "【AI サマリー】", data.aiSummary, "");
  }

  for (const [category, entries] of grouped) {
    lines.push(`■ ${categoryLabel(category)}`);
    for (const entry of entries) {
      lines.push(`  ・${entry.content}`);
      if (entry.originalQuote) {
        lines.push(`    「${entry.originalQuote}」`);
      }
    }
    lines.push("");
  }

  lines.push(sep, `出力日時: ${now}`);

  const text = lines.join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `karute_${data.customerName}_${data.date}.txt`;
  document.body.appendChild(a);
  a.click();

  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

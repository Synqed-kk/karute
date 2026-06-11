#!/usr/bin/env python3
"""P4 import dry-run (READ-ONLY). Matches the Kitano 顧客管理 sheet against the
live customer list by EXACT normalized name (1:1 enforced — ambiguity is
reported, never guessed). Emits a human report + /tmp/import-plan.json."""
import csv, json, re, unicodedata
from collections import defaultdict

SHEET = "/Users/liam/Downloads/2026 La Estro 代官山 - 顧客管理.csv"
DUMP = "/tmp/karute-customers.json"
HIRA = re.compile(r"^[ぁ-ん]")

def norm(name: str) -> str:
    s = unicodedata.normalize("NFKC", name or "").strip()
    s = s.replace(" ", "").replace("　", "")
    s = re.sub(r"様$", "", s)
    return s

def candidates(sheet_name: str):
    n = norm(sheet_name)
    out = [n]
    # the sheet prepends ONE hiragana sort char (お小川拓也 → 小川拓也)
    if HIRA.match(n) and len(n) >= 3:
        out.append(n[1:])
    return out

def yen(s):
    s = (s or "").replace("¥", "").replace(",", "").strip()
    return int(s) if s.isdigit() else None

dump = json.load(open(DUMP))
app = dump["customers"]
app_by_norm = defaultdict(list)
for c in app:
    app_by_norm[norm(c["name"])].append(c)

rows = list(csv.reader(open(SHEET, encoding="utf-8-sig")))
header = rows[7]
data = []
for r in rows[8:]:
    name = (r[4] if len(r) > 4 else "").strip()
    if not name:
        continue
    data.append({
        "sheet_name": name,
        "graduated": (r[1] or "").strip() != "",
        "lost": (r[2] or "").strip() != "",
        "referral": (r[3] or "").strip() != "",
        "staff": (r[5] or "").strip(),
        "round_raw": (r[6] or "").strip(),
        "next_booking": (r[7] or "").strip(),
        "pack_raw": (r[8] or "").strip(),
        "unit_price": yen(r[9] if len(r) > 9 else ""),
        "remaining_raw": (r[11] or "").strip() if len(r) > 11 else "",
        "balance": yen(r[12] if len(r) > 12 else ""),
        "first_visit": (r[13] or "").strip() if len(r) > 13 else "",
        "last_visit": (r[14] or "").strip() if len(r) > 14 else "",
        "visit_count_raw": (r[16] or "").strip() if len(r) > 16 else "",
        "visit_dates": [x.strip() for x in r[17:] if x.strip()],
    })

matched, ambiguous, sheet_only = [], [], []
claimed = {}
warnings = []
for row in data:
    hits = []
    for cand in candidates(row["sheet_name"]):
        hits.extend(app_by_norm.get(cand, []))
    hits = list({h["id"]: h for h in hits}.values())
    if len(hits) == 1:
        cid = hits[0]["id"]
        if cid in claimed:
            ambiguous.append({**row, "reason": f"app customer also matches sheet row '{claimed[cid]}'", "app": hits[0]["name"]})
            continue
        claimed[cid] = row["sheet_name"]
        # pack parse
        plan = {"sheet_name": row["sheet_name"], "app_id": cid, "app_name": hits[0]["name"]}
        m = re.search(r"(\d+)回", row["pack_raw"]) if row["pack_raw"] else None
        is_sub = "サブスク" in row["pack_raw"]
        rem = int(row["remaining_raw"]) if row["remaining_raw"].isdigit() else None
        rnd = 1
        rm = re.search(r"(\d+)", row["round_raw"])
        if "初回" in row["round_raw"]: rnd = 1
        elif rm: rnd = int(rm.group(1))
        if is_sub:
            plan["pack"] = {"kind": "subscription", "raw": row["pack_raw"]}
        elif m:
            size = int(m.group(1))
            if rem is None: rem = 0
            consumed = size - rem
            if consumed < 0:
                warnings.append(f"{row['sheet_name']}: 残{rem} > {size}回 — impossible, NEEDS REVIEW")
                consumed = None
            if row["unit_price"] and rem is not None and row["balance"] is not None:
                if row["unit_price"] * rem != row["balance"]:
                    warnings.append(f"{row['sheet_name']}: 残高 ¥{row['balance']} ≠ 残{rem}×¥{row['unit_price']}")
            plan["pack"] = {"kind": "pack", "size": size, "unit_price": row["unit_price"] or 0,
                            "remaining": rem, "consumed": consumed, "round": rnd,
                            "last_visit": row["last_visit"], "visit_dates_available": len(row["visit_dates"])}
        lc = None
        if row["graduated"] and row["lost"]:
            warnings.append(f"{row['sheet_name']}: 卒業 AND 離客 both set — NEEDS REVIEW")
        elif row["graduated"]: lc = "graduated"
        elif row["lost"]: lc = "lost"
        plan["lifecycle"] = lc
        plan["referral"] = row["referral"]
        plan["last_visit"] = row["last_visit"]
        matched.append(plan)
    elif len(hits) > 1:
        ambiguous.append({**row, "reason": f"{len(hits)} app customers match", "apps": [h["name"] for h in hits]})
    else:
        sheet_only.append(row)

matched_ids = set(claimed)
app_only = [c for c in app if c["id"] not in matched_ids]

packs = [m for m in matched if m.get("pack", {}).get("kind") == "pack"]
subs = [m for m in matched if m.get("pack", {}).get("kind") == "subscription"]
lcs = [m for m in matched if m["lifecycle"]]
refs = [m for m in matched if m["referral"]]

print(f"sheet rows: {len(data)} | app customers: {len(app)} (tenant: {dump['tenant']})")
print(f"MATCHED 1:1: {len(matched)}")
print(f"  with counted pack: {len(packs)} | サブスク: {len(subs)} | 卒業/離客: {len(lcs)} | 口コミ: {len(refs)}")
print(f"AMBIGUOUS: {len(ambiguous)}")
for a in ambiguous[:6]: print("  -", a["sheet_name"], "→", a["reason"])
print(f"SHEET-ONLY (not in app): {len(sheet_only)}")
g = sum(1 for r in sheet_only if r["graduated"] or r["lost"])
print(f"  of which 卒業/離客 (historical): {g}")
print(f"APP-ONLY (not on sheet): {len(app_only)}")
for c in app_only[:8]: print("  -", c["name"])
print(f"WARNINGS: {len(warnings)}")
for w in warnings[:10]: print("  ⚠", w)
tot_rem = sum(p["pack"]["remaining"] * p["pack"]["unit_price"] for p in packs if p["pack"]["remaining"] is not None and p["pack"]["unit_price"])
print(f"projected 未消化総額 after import: ¥{tot_rem:,}")
json.dump({"businessId": dump["businessId"], "matched": matched, "ambiguous_count": len(ambiguous),
           "warnings": warnings}, open("/tmp/import-plan.json", "w"), ensure_ascii=False, indent=1)
print("plan written → /tmp/import-plan.json")

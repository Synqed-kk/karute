'use client'
// Verified port of Synqed-kk/reserve @ 4db48b73ba70 (2026-09-30 19:37 JST) — the member card's
// three surfaces as Reserve draws them: the big Home card (.mcard), the small card (.tcard) and the
// store cover (.salon-cover). Never a second drawing: the markup below is Reserve's JSX, the two
// measure effects are byte-identical copies, and the look lives in reserve-card.css (verbatim rules).
// Proof: scripts/business/reserve-card-parity/run.mjs (pixel parity vs Reserve's own page); PARITY.md.
//
// Non-verbatim, and why (each is also listed in PARITY.md):
// - No routing, no motion: Reserve's <Link to=… onClick={startMorph…}> becomes a plain <a> with no href
//   (same element, so the same CSS matches; nothing navigates); its aria-label (a link's name) goes with it.
//   useCardMotion / useSheenFollow / the cover's drag + Escape effects are not ported (the packet: no motion
//   code beyond what the CSS carries), so the sheen's ref and the cover's coverRef are dropped.
// - lucide-react icons are inlined as the exact <svg> lucide-react 1.24.0 (Reserve's lockfile) renders —
//   Business territory may import only react/next (business-isolation.test.ts).
// - i18n keys are printed as the Japanese Reserve's ja/member.json holds at 4db48b7.
// - The customer context is Reserve's own demo member at a fixed date (the approved mock's 9/14 sample):
//   greeting, next visit, chips, the small card's line. The NAME, branch, address and colour are the props.
// - The small card (.tcard) shows THIS business's own name (isolation law), never another business's.
// - The cover's name is a <div>, not Reserve's <h1> (same className): settings.css:191
//   `.biz .page.pg-settings h1` (0,3,1) outranks the wordmark rule inside the settings room. The preview is a
//   picture of the card (the section marks its root aria-hidden), so it carries no heading.
// - reserve-card.css index.css:214–221 (.pressable) is SCOPED, not verbatim: selectors prefixed `.member-ground `,
//   declarations byte-identical to Reserve.
// - reserve-card.css index.css:237–246 (.tap44) is SCOPED, not verbatim: selectors prefixed `.member-ground `,
//   declarations byte-identical to Reserve.
// - reserve-card.css index.css:254–263 (.rank-chip) is SCOPED, not verbatim: selectors prefixed `.member-ground `,
//   declarations byte-identical to Reserve.
// - The cover's lines 2 and 3 are Reserve's two <p>s, fed by coverLinesOf below: the SHAPE of Reserve's
//   member-ia.ts coverLines (458–479), never its data (store lookup, practice hours, closures, clock). A
//   storeLine with an address prints Reserve's store branch (shortName + the address split at the Latin
//   building name); a storeLine without one prints no line 3 — the port's own empty state for a store whose address
//   Business does not hold (Reserve never draws that case: member-ia.ts:468–469, a non-practice store always
//   has an address and a practice store gets its kind label as line 2); an empty storeLine prints the category and 「いつでもご予約いただけます」. The category is fixed to GENERIC 「お店」 because the
//   port carries no business type. Fallback branch: same markup as Reserve, not pixel-proven (no store-less
//   case in the harness set).
// - The first chip's crown drops Reserve's rank gate (`me.salons.some(… && salon.rank)`): the port's sample
//   member is ranked and the port carries no membership data, so the crown always shows on the first chip.
// - Reserve's branch rule (studio-home.tsx:478, :514) is carried with the port's prop names: storeLine ↔ store.shortName, name ↔ row.tenant.displayName.
// - Colour inputs are normalised at the boundary (card-color.ts): only `#RRGGBB` reaches the satin math; anything
//   else counts as absent — identical on server and client, no hydration drift.
import { useLayoutEffect, useRef, useState } from "react";

import { normalizeCardColor } from "./card-color";
import { memberTenantVars, type BrandTheme } from "./member-card-vars";
import type { StorePageSample } from "./store-page-sample";
import { CAP_KEYS, ready as capReady, type CapKey, type CapRecord } from "@/business/lib/store-page/model";
import "./reserve-card.css";

export interface ReserveCardPreviewProps {
  /** the business's display name, as Reserve prints it on the card and the cover */
  name: string;
  /** the branch line under the name (Reserve: the store's shortName) */
  storeLine: string;
  /** the business's chosen card colour (#RRGGBB) — null = Reserve's `cardColor ?? primaryColor` fallback */
  cardColor: string | null;
  /** the business's brand colour; the caller decides it — this module invents none */
  primaryColor?: string;
  /** the store's address, as the cover prints it (Reserve: store.address); omitted = no address line */
  address?: string;
  view: "home" | "store";
  /** the store's public projection (snake_case keys, a sub only while its parent is ON); absent = cover only */
  on?: ReadonlySet<string>;
  /** the practice sample the body draws (store-page-sample.ts); absent = cover only */
  sample?: StorePageSample;
  /** ⚖ S64 R240 — the business's square mark, a URL the caller owns (today the practice pick's blob: URL), shown exactly as uploaded BEFORE the name; absent or '' = the name alone, exactly as before */
  markUrl?: string;
}

function Emb({ className, src }: { className: string; src?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- ⚖ S64 R240 (MOCK :1171): a blob: URL shown exactly as uploaded, no mask, no style; next/image cannot serve it
  return src ? <img className={className} data-logo="1" alt="" aria-hidden="true" src={src} /> : null;
}

// The demo member Reserve's mock shows at 4db48b7 (src/lib/mock.ts + ja/member.json), frozen on the
// approved mock's date (MOCK-SWITCHBOARD-v2 BIZ.laestro.next = 9/14（月）14:30).
const SAMPLE = {
  greetHi: "こんにちは",
  greetName: "山田 美穂さん",
  cardMore: "詳しく見る",
  nextBooking: "次回のご予約",
  nextAt: "9/14（月）14:30",
  chips: ["ゴールド", "回数券 残り4回", "ホームケア 1件"],
  smallLine: "いつでもご予約いただけます",
  coverCategory: "お店",
  back: "ホーム",
} as const;

// lucide-react 1.24.0 ChevronRight / Crown / ChevronLeft, as rendered (defaultAttributes + __iconNode).
function ChevronRight({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className ? `lucide lucide-chevron-right ${className}` : "lucide lucide-chevron-right"} aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
function ChevronLeft({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-left" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
function Crown({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-crown" aria-hidden="true">
      <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
      <path d="M5 21h14" />
    </svg>
  );
}

// reserve src/components/customer/membership-date.tsx:1–6 @ 4db48b7, verbatim
/** Shared date markup from the approved mock; the weekday keeps its smaller size. */
export function MembershipDate({ value }: { value: string }) {
  return <>{value.split(/(（[^）]*）)/).map((part, index) =>
    part.startsWith('（') ? <span className="membership-weekday" key={index}>{part}</span> : part
  )}</>;
}

// lucide-react 1.24.0 CalendarDays / QrCode (Reserve BookEntry / CheckinEntry icons), as rendered.
function CalendarDays({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-calendar-days" aria-hidden="true">
      <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" />
      <path d="M8 14h.01" /><path d="M12 14h.01" /><path d="M16 14h.01" /><path d="M8 18h.01" /><path d="M12 18h.01" /><path d="M16 18h.01" />
    </svg>
  );
}
function QrCode({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-qr-code" aria-hidden="true">
      <rect width="5" height="5" x="3" y="3" rx="1" /><rect width="5" height="5" x="16" y="3" rx="1" /><rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" /><path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" /><path d="M3 12h.01" />
      <path d="M12 3h.01" /><path d="M12 16v.01" /><path d="M16 12h1" /><path d="M21 12v.01" /><path d="M12 21v-1" />
    </svg>
  );
}

export function ReserveCardPreview({ name, storeLine, cardColor, primaryColor, address, view, on, sample, markUrl }: ReserveCardPreviewProps) {
  // ⚖ S64 R245 — the measure effects run on mount only, so the two measured surfaces remount when a mark arrives or leaves (Emb's own test); a mark replaced by another changes no width and remounts nothing
  const markKey = markUrl ? "mark" : "name";
  // Reserve's MembershipCard/TenantCard/StudioCover each take `memberTenantVars(theme)`; the theme here is
  // the two colours the caller owns. The same vars also sit on the root (packet): custom properties inherit.
  // Each colour passes the boundary first; a null is the absent colour Reserve already handles (satin default).
  const theme: BrandTheme = { cardColor: normalizeCardColor(cardColor) ?? undefined, primaryColor: normalizeCardColor(primaryColor) ?? undefined };
  const vars = memberTenantVars(theme);
  // the shape the two verbatim measure effects read (`row.tenant.displayName` / `tenant.displayName`)
  const tenant = { displayName: name };
  return (
    <div className="member-ground reserve-card-preview" style={vars}>
      {view === "home" ? (
        // Reserve WalletPage's <main className="flex-1 w-full max-w-md mx-auto px-5 pt-10 sm:pt-14 pb-6 main--greet">,
        // minus the page-only parts (a second <main> landmark, flex-1, the pt-* that main--greet zeroes).
        <div className="w-full max-w-md mx-auto px-5 pb-6">
          <div className="studio-greet">
            <p className="studio-greet__hi">{SAMPLE.greetHi}</p>
            <p className="studio-greet__name">{SAMPLE.greetName}</p>
          </div>
          <div className="studio-cards">
            <MembershipCard key={markKey} row={{ tenant }} storeLine={storeLine} cardTheme={theme} markUrl={markUrl} />
            <TenantCard row={{ tenant }} cardTheme={theme} markUrl={markUrl} />
          </div>
        </div>
      ) : (
        <>
          <StudioCover key={markKey} tenant={tenant} storeLine={storeLine} address={address} theme={theme} markUrl={markUrl} />
          {on && sample && <StoreBody on={on} sample={sample} />}
        </>
      )}
    </div>
  );
}

/** reserve studio-home.tsx MembershipCard (376–539) — the card block, static. */
function MembershipCard({
  row,
  storeLine,
  cardTheme,
  markUrl,
}: {
  row: { tenant: { displayName: string } };
  storeLine: string;
  cardTheme: BrandTheme;
  markUrl?: string;
}) {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const chips = SAMPLE.chips;
  // studio-home.tsx:434–472 @ 4db48b7, verbatim
  const probeRef = useRef<HTMLSpanElement>(null);
  const [nameIsLong, setNameIsLong] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const card = cardRef.current, probe = probeRef.current;
      const ground = card?.closest<HTMLElement>(".member-ground");
      const hd = card?.querySelector<HTMLElement>(".mcard__hd");
      const chevron = card?.querySelector(".mcard__more")?.querySelector("svg");
      if (!card || !probe || !ground || !hd || !chevron) return;
      const yard = ground.clientWidth - 50;
      const col = .75 * yard;
      const gap = parseFloat(getComputedStyle(hd).columnGap);
      const cue = parseFloat(chevron.getAttribute("width") ?? "");
      const room = hd.clientWidth - gap - cue;
      const long = probe.offsetWidth + 1 > yard && col <= room;
      if (long) card.style.setProperty("--mcard-col", `${col}px`);
      else card.style.removeProperty("--mcard-col");
      card.classList.toggle("mcard--long", long);
      setNameIsLong(long);
    };
    measure();
    const ground = cardRef.current?.closest<HTMLElement>(".member-ground");
    let ro: ResizeObserver | undefined;
    let usingResizeListener = false;
    if (typeof ResizeObserver !== "undefined" && ground) {
      ro = new ResizeObserver(measure);
      ro.observe(ground);
    } else {
      usingResizeListener = true;
      window.addEventListener("resize", measure);
    }
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => {
      cancelled = true;
      ro?.disconnect();
      if (usingResizeListener) window.removeEventListener("resize", measure);
    };
  }, [cardRef, row.tenant.displayName]);
  // reserve studio-home.tsx:478, with the port's prop names — a store named like the card has no branch to add
  const branch = storeLine && storeLine !== row.tenant.displayName ? storeLine : null;

  return (
    <a
      ref={cardRef}
      style={memberTenantVars(cardTheme)}
      className={`mcard pressable outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50${nameIsLong ? " mcard--long" : ""}`}
    >
      <span className="mcard__sheenwrap" aria-hidden>
        <span className="mcard__sheen" />
      </span>
      <span className="mcard__in">
        <span className="mcard__hd">
          <Emb className="mcard__emb" src={markUrl} />
          {/* the ONE thing that travels with the box into the store cover */}
          <span className="mcard__wm" data-morph-wm>
            {row.tenant.displayName}
          </span>
          <span className="mcard__more" data-morph-hide>
            {SAMPLE.cardMore}
            <ChevronRight size={14} />
          </span>
        </span>
        {branch && (
          <span className="mcard__store" data-morph-branch>
            {storeLine}
          </span>
        )}
        {/* studio-home.tsx NextVisitBody (644–649), static */}
        <span className="mcard__mid">
          <span className="mcard__eb" data-morph-label>{SAMPLE.nextBooking}</span>
          <span className="mcard__big" data-morph-date><MembershipDate value={SAMPLE.nextAt} /></span>
        </span>
        {chips.length > 0 && (
          <span className="mcard__foot" data-morph-hide>
            {chips.map((chip, index) => (
              <span key={chip} className="mcard__chip">
                {index === 0 && <Crown size={13} />}{chip}
              </span>
            ))}
          </span>
        )}
      </span>
      {/* the cover's own probe (PKT-CARD-STAGE-3 above): hidden, nowrap, 36px.
          It carries NO data-morph-* attribute on purpose — member-morph.ts's
          nameOf/glyphsOf read [data-morph-wm] and must never see it. */}
      <span className={`salon-cover__wm-probe${markUrl ? " withemb" : ""}`} aria-hidden="true" ref={probeRef}>
        {row.tenant.displayName}
      </span>
    </a>
  );
}

/** reserve studio-home.tsx TenantCard (671–706) — the small card, static. */
function TenantCard({ row, cardTheme, markUrl }: { row: { tenant: { displayName: string } }; cardTheme: BrandTheme; markUrl?: string }) {
  const chips = SAMPLE.chips;
  return (
    <a
      style={memberTenantVars(cardTheme)}
      className="tcard pressable outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="mcard__sheenwrap" aria-hidden>
        <span className="mcard__sheen" />
      </span>
      <span className="tcard__body">
        <Emb className="tcard__emb" src={markUrl} />
        <span className={markUrl ? "tcard__name withemb" : "tcard__name"} data-morph-wm>{row.tenant.displayName}</span>
        <span className="tcard__sub" data-morph-hide>
          {SAMPLE.smallLine}
        </span>
      </span>
      {chips.length > 0 && <span className="tcard__chip" data-morph-hide>{chips[chips.length - 1]}</span>}
    </a>
  );
}

/** reserve member-ia.ts coverLines (458–479) — the cover's lines 2 and 3, its SHAPE only (see the header). */
function coverLinesOf(storeLine: string, address?: string): { line2: string; line3: string | string[] | null } {
  if (storeLine) return { line2: storeLine, line3: address ? address.replace(/\s+(?=[A-Z])/, "\n").split("\n") : null };
  return { line2: SAMPLE.coverCategory, line3: SAMPLE.smallLine };
}

/** reserve studio-salon.tsx StudioCover (42–238) — the cover, static. */
function StudioCover({
  tenant,
  storeLine,
  address,
  theme,
  markUrl,
}: {
  tenant: { displayName: string };
  storeLine: string;
  address?: string;
  theme: BrandTheme;
  markUrl?: string;
}) {
  const { line2, line3 } = coverLinesOf(storeLine, address);
  // studio-salon.tsx:75–121 @ 4db48b7, verbatim
  const nameRef = useRef<HTMLHeadingElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [nameIsLong, setNameIsLong] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const h = nameRef.current, p = probeRef.current;
      if (!h || !p) return;
      // The h1 is shrink-to-fit (its own width is just the text's width, so
      // it cannot be the yardstick): the probe is compared with the COLUMN
      // the name may use — the h1's offset parent's clientWidth minus the
      // 25px gutter on each side (2 * h.offsetLeft). Still LAYOUT widths
      // only: an ancestor's entrance transform (member-page scales the
      // incoming page from 0.985) cannot distort them. offsetWidth is
      // rounded, so +1 keeps the answer on the safe side: a wrong "long" is
      // a slightly smaller name, a wrong "short" clips.
      const col = h.offsetParent as HTMLElement | null;
      if (!col) return;
      const long = p.offsetWidth + 1 > col.clientWidth - 2 * h.offsetLeft;
      // Put the class on the element NOW, inside this layout effect: the salon
      // page's own layout effect (landMorph) runs later in this same commit and
      // freezes the wordmark's geometry — it must read the measured size, not
      // the first render's. The state keeps later renders in agreement.
      h.classList.toggle("salon-cover__wm--long", long);
      setNameIsLong(long);
    };
    measure();
    // `column` is `.salon-cover__in`, the name's own offset parent — the
    // very box `measure()` above uses as its yardstick, which is why this
    // observer can never be stale.
    const column = nameRef.current?.parentElement;
    let ro: ResizeObserver | undefined;
    let usingResizeListener = false;
    if (typeof ResizeObserver !== "undefined" && column) {
      ro = new ResizeObserver(measure);
      ro.observe(column);
    } else {
      usingResizeListener = true;
      window.addEventListener("resize", measure);
    }
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => {
      cancelled = true;
      ro?.disconnect();
      if (usingResizeListener) window.removeEventListener("resize", measure);
    };
  }, [tenant.displayName]);

  return (
    <div
      className="salon-cover"
      style={memberTenantVars(theme)}
    >
      <span className="mcard__sheenwrap" aria-hidden>
        <span className="mcard__sheen" />
      </span>
      <div className="salon-cover__in" role="region" aria-label={tenant.displayName}>
        <a
          data-morph-hide
          className="salon-cover__back tap44 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-white/60"
        >
          <ChevronLeft size={15} />
          {SAMPLE.back}
        </a>
        <div
          ref={nameRef}
          className={`salon-cover__wm${nameIsLong ? " salon-cover__wm--long" : ""}${markUrl ? " withemb" : ""}`}
          data-morph-wm
        >
          <Emb className="salon-cover__emb" src={markUrl} />
          {tenant.displayName}
        </div>
        <span className={`salon-cover__wm-probe${markUrl ? " withemb" : ""}`} aria-hidden="true" ref={probeRef}>
          {tenant.displayName}
        </span>
        <p className="salon-cover__st" data-morph-branch>
          {line2}
        </p>
        <p className="salon-cover__ad" data-morph-hide>
          {Array.isArray(line3) ? line3.map((line, index) => <span key={index} className="block">{line}</span>) : line3}
        </p>
      </div>
    </div>
  );
}

// The mock's `ready(k)` (MOCK-SWITCHBOARD-v2 :1564-1569) is P1's `ready()` — one table, one rule. The body gets
// the PUBLIC projection (`on`), so the record it asks about is that set: a key is ON exactly when projected.
const projected = (on: ReadonlySet<string>): CapRecord => ({
  v: 1,
  business_type: "other", // a type key (R171); ready() reads only the switches
  defaults_type: "other",
  switches: Object.fromEntries(CAP_KEYS.map((k) => [k, { on: on.has(k), source: "TYPE_DEFAULT" }])) as CapRecord["switches"],
});

/**
 * The お店ページ body under the cover, part 1 — spec §E1 items 2-5 and 8, in the mock's order (phoneMarkup
 * :1769-1899). Markup + classes are Reserve's @ 09841a6 (MemberSalonPage.tsx :262-307 rank chip / 次回 / acts,
 * RankStreakChip :354-366, BookEntry :460-480, CheckinEntry :486-499; studio-salon.tsx IntakeBanner :401-436,
 * SalonPosts :277-312); the WORDS are the mock's (the sample's rv data and the mock's own literals). Edits:
 * Reserve's <section>s are <div>s (the settings tour census counts <section> tags, R67); <Link>/<Button> become
 * <a>/<button disabled> with no href/handler (a picture: nothing focusable, nothing navigates); shadcn Button's
 * own base classes are not carried (the .salon-acts rules set every drawn property); Reserve's points row,
 * intake 「未記入」 chip and 読みました state are not drawn (the mock has none of them); the reactions line has
 * no Reserve source and is drawn from the mock (.rv .react :501, D-PHONE).
 * Part 2 (P4b, spec §E1 items 6, 7, 9-12): ご予約 = MemberSalonPage.tsx UpcomingBookings :385-452; shop / rental =
 * studio-salon.tsx ShopSection :327-352 / RentalSection :361-390 (their thumb, 注文する / お申し込み are the mock's;
 * Reserve's goodsFooter line is not drawn — the mock has none); classes + キャンセル待ち and the tab bar have no
 * Reserve store-page source and are drawn from the mock (:1809-1825, :1897; D-PHONE). Order = the mock's: Reserve
 * puts the intake row UNDER ご予約 (MemberSalonPage.tsx :310-314), the mock above it — the mock wins (spec E1).
 */
function StoreBody({ on, sample }: { on: ReadonlySet<string>; sample: StorePageSample }) {
  const v = sample.rv;
  const rec = projected(on);
  const ready = (key: string) => capReady(key as CapKey, rec, sample.counts);
  const readPoints = on.has("read_points");
  const reactions = on.has("reactions");
  return (
    <>
    <div className="px-[22px] pb-6" data-store-body="">
      {v.rank && (
        <div className="salon-rankfloat">
          <span className="rank-chip shrink-0" data-tier={v.rank.split(" ")[0]}>
            <Crown size={11} />{v.rank}
          </span>
        </div>
      )}
      {v.next.big && (
        <div className="salon-next">
          <p className="salon-next__label">{v.next.line}</p>
          <p className="salon-next__date"><MembershipDate value={v.next.big} /></p>
          {ready("packs") && <span className="salon-next__meta" data-cap="packs_chip">{v.next.side}</span>}
        </div>
      )}
      <div className="salon-acts">
        <button type="button" disabled className="flex-1 h-12 rounded-full elev-float pressable salon-acts__primary">
          <CalendarDays size={16} />予約する
        </button>
        {ready("checkin_qr") && (
          <button type="button" disabled aria-haspopup="dialog" className="h-12 rounded-full px-5 pressable" data-cap="checkin_qr">
            <QrCode size={17} />受付
          </button>
        )}
      </div>
      {ready("intake") && (
        <div className="mt-8" data-cap="intake">
          <a className="flex items-center gap-3 bg-card pressable outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 member-solo-row">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium member-row__t font-normal">問診票のご記入をお願いします</span>
              <span className="block text-[13px] text-muted-foreground mt-0.5 member-row__s">ご来店までに、3つの質問にお答えください。</span>
            </span>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </a>
        </div>
      )}
      {v.bookings.length > 0 && (
        <div className="mt-8">
          <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">ご予約</h2>
          <div className="bg-card divide-y divide-border/60 member-rows">
            {v.bookings.map((booking, i) => (
              <a key={`${i}:${booking.t}`} className="flex items-center gap-3 pressable outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className="min-w-0 flex-1">
                  <span className="member-row__t block">{booking.t}</span>
                  <span className="member-row__s block text-muted-foreground">{booking.s}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}
      {ready("classes") && (
        <div className="salon-classes mt-8" data-cap="classes">
          <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">レッスンを予約</h2>
          <div className="salon-classes__days">
            <span data-on="">今日 9/14</span><span>明日 9/15</span><span>火 9/16</span>
          </div>
          <div className="member-rows bg-card divide-y divide-border/60">
            {v.classes.map((c, i) => (
              <div key={`${i}:${c.tm}`} className="salon-classes__row" data-full={c.seats > 0 ? undefined : ""}>
                <span className="salon-classes__tm">{c.tm}</span>
                <span className="min-w-0 flex-1">
                  <span className="member-row__t block">{c.nm}</span>
                  <span className="member-row__s block text-muted-foreground">{c.sub}</span>
                </span>
                <span className="salon-classes__seats">{c.seats > 0 ? `残り${c.seats}枠` : "満席"}</span>
                {!(c.seats > 0) && on.has("waitlist") && (
                  <span className="salon-classes__wl" data-cap="waitlist"><span>キャンセル待ちに登録</span></span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {ready("posts") && (
        <div className="salon-posts mt-8" data-cap="posts">
          <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">
            お店からのお知らせ{readPoints && <small>読むとポイントがたまります</small>}
          </h2>
          <div className="member-rows bg-card divide-y divide-border/60">
            {v.posts.map((post, i) => (
              <a key={`${i}:${post.t}`} className="flex items-center gap-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className="min-w-0 flex-1">
                  <span className="member-row__t block">{post.t}</span>
                  <span className="member-row__s block text-muted-foreground">{post.d}</span>
                  {reactions && <span className="salon-posts__react block" data-cap="reactions">♡ いいね ・ 💬 コメント</span>}
                </span>
                {readPoints && <span className="member-chip member-chip--rw" data-cap="read_points">+5pt</span>}
              </a>
            ))}
          </div>
        </div>
      )}
      {ready("shop") && (
        <div className="salon-goods mt-8" data-cap="shop">
          <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">
            ショップ<small>お店で受け取り</small>
          </h2>
          <div className="member-rows bg-card divide-y divide-border/60">
            {v.products.map((product, i) => (
              <div key={`${i}:${product.t}`} className="flex items-center gap-3">
                <span className="salon-goods__thumb" style={{ background: product.c }} />
                <span className="min-w-0 flex-1">
                  <span className="member-row__t block">{product.t}</span>
                  <span className="member-row__s block text-muted-foreground">{product.pr}</span>
                </span>
                <span className="salon-goods__buy">注文する</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ready("rental") && v.lockers && (
        <div className="salon-goods mt-8" data-cap="rental">
          <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">ロッカー・レンタル</h2>
          <div className="member-rows bg-card divide-y divide-border/60">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="member-row__t block">{v.lockers.t}</span>
                <span className="member-row__s block text-muted-foreground">{v.lockers.d}</span>
              </span>
              <span className="salon-goods__buy">お申し込み</span>
            </div>
          </div>
        </div>
      )}
      <MyRecord key={sample.name} ready={ready} photo={on.has("photo_proof")} sample={sample} />
    </div>
    <div className="salon-tabbar"><div data-on="">ホーム</div><div>予約</div><div>ためる</div><div>マイページ</div></div>
    </>
  );
}

type SegmentKey = "visits" | "packs" | "care";
const SEGMENT_JA: Readonly<Record<SegmentKey, string>> = { visits: "来店履歴", packs: "回数券", care: "ホームケア" };

/**
 * わたしの記録 (spec §E1 item 11 + D23). Shape = Reserve MemberSalonPage.tsx MyRecord :508-588 @ 09841a6 (segments
 * computed from the switches; visits always) with studio-salon.tsx SegTabs :448-531 (its spring is NOT carried — the
 * rule jumps, so nothing animates) and visit-history-list.tsx :21-72 rows; the WORDS and the pack/care/empty rows
 * are the mock's (phoneMarkup :1854-1893, D-PHONE). The open tab falls back to 来店履歴 when its key goes away (the
 * mock's own rule :1859: the fallback sticks, the tab does not reopen when the key comes back).
 */
function MyRecord({ ready, photo, sample }: { ready: (key: string) => boolean; photo: boolean; sample: StorePageSample }) {
  const v = sample.rv;
  const segments: SegmentKey[] = ["visits"];
  if (ready("packs")) segments.push("packs");
  if (ready("homecare")) segments.push("care");
  const [tab, setTab] = useState<SegmentKey>("visits");
  if (!segments.includes(tab)) setTab("visits");
  const active = segments.includes(tab) ? tab : "visits";
  const wrapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const btn = wrapRef.current?.querySelector<HTMLElement>('button[aria-selected="true"]');
    const line = lineRef.current;
    if (!btn || !line) return;
    line.style.width = `${btn.offsetWidth}px`;
    line.style.transform = `translateX(${btn.offsetLeft}px)`;
  }, [active, segments.length]);
  const rows = (items: ReadonlyArray<{ readonly t: string; readonly d: string }>, extra = "") => (
    <div className="visit-rows bg-card divide-y divide-border/60">
      {items.map((item, i) => (
        <div key={`${i}:${item.t}`} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="visit-row__t text-sm font-medium">{item.t}</p>
            <p className="visit-row__m text-xs text-muted-foreground mt-0.5">{item.d}{extra}</p>
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="salon-record mt-9" data-record="">
      <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">わたしの記録</h2>
      <div ref={wrapRef} role="tablist" aria-label="わたしの記録" className="salon-segs">
        {segments.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            tabIndex={-1}
            aria-selected={key === active}
            onClick={() => setTab(key)}
            className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-cap={key === "packs" ? "packs" : key === "care" ? "homecare" : undefined}
          >
            {SEGMENT_JA[key]}
          </button>
        ))}
        <span ref={lineRef} className="salon-segline" aria-hidden="true" />
      </div>
      <div className="mt-4" role="tabpanel" aria-label={SEGMENT_JA[active]}>
        {active === "visits" && (v.visits.length > 0 ? (
          <>
            <div className="visit-rows rounded-2xl bg-card elev-card divide-y divide-border/60">
              {v.visits.map((visit, i) => (
                <div key={`${i}:${visit.d}`} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="visit-row__t text-sm font-medium">{visit.t}</p>
                    <p className="visit-row__m text-xs text-muted-foreground mt-0.5">
                      {visit.d.split(" ・ ").map((seg, i) => (
                        <span key={i}>{i > 0 && " ・ "}<span className="visit-row__seg">{seg}</span></span>
                      ))}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {"badge" in visit && visit.badge && (
                      <span className="member-chip inline-block rounded-full bg-secondary text-secondary-foreground text-[10px] font-medium px-2 py-0.5 mb-0.5">{visit.badge}</span>
                    )}
                    {"money" in visit && visit.money && (
                      <p className="text-sm font-semibold"><span className="price-num">{visit.money}</span> <span className="salon-record__tax">税込</span></p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <a className="mt-3 inline-flex items-center gap-0.5 text-xs font-medium text-primary rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pressable tameru-tbtn">
              すべての来店履歴<ChevronRight size={13} />
            </a>
          </>
        ) : (
          <div className="salon-record__empty">
            <p className="salon-record__empty-t">まだ来店の記録はありません</p>
            <p className="salon-record__empty-s">{v.emptyVisits}</p>
          </div>
        ))}
        {active === "packs" && rows(v.packs)}
        {active === "care" && rows(v.care, photo ? " ・ 写真で報告できます" : "")}
      </div>
    </div>
  );
}

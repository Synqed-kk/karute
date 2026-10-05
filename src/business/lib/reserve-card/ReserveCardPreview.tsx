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

export function ReserveCardPreview({ name, storeLine, cardColor, primaryColor, address, view, on, sample }: ReserveCardPreviewProps) {
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
            <MembershipCard row={{ tenant }} storeLine={storeLine} cardTheme={theme} />
            <TenantCard row={{ tenant }} cardTheme={theme} />
          </div>
        </div>
      ) : (
        <>
          <StudioCover tenant={tenant} storeLine={storeLine} address={address} theme={theme} />
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
}: {
  row: { tenant: { displayName: string } };
  storeLine: string;
  cardTheme: BrandTheme;
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
          {/* B's slot (MOCK-VERDICT 9/23): the square mark <span className="mcard__emb ink" style={{"--lg": …}}/> goes here, before the name — Stage 4 renders it; its geometry is already in index.css */}
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
      <span className="salon-cover__wm-probe" aria-hidden="true" ref={probeRef}>
        {row.tenant.displayName}
      </span>
    </a>
  );
}

/** reserve studio-home.tsx TenantCard (671–706) — the small card, static. */
function TenantCard({ row, cardTheme }: { row: { tenant: { displayName: string } }; cardTheme: BrandTheme }) {
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
        <span className="tcard__name" data-morph-wm>{row.tenant.displayName}</span>
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
}: {
  tenant: { displayName: string };
  storeLine: string;
  address?: string;
  theme: BrandTheme;
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
          className={`salon-cover__wm${nameIsLong ? " salon-cover__wm--long" : ""}`}
          data-morph-wm
        >
          {tenant.displayName}
        </div>
        <span className="salon-cover__wm-probe" aria-hidden="true" ref={probeRef}>
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

// The mock's `ready(k)` (MOCK-SWITCHBOARD-v2 :1564-1569): ON and (no count needed, or the count > 0). The count
// keys are the mock REG `need` fields (:880-916) for the four parents this body reads; CHECKIN_QR needs none.
// (P1's store-page model owns the full table; this body reads only these four.)
const NEED: Readonly<Record<string, string>> = { packs: "packs", posts: "posts", intake: "questions" };
const readyIn = (on: ReadonlySet<string>, counts: Readonly<Record<string, number>>, key: string) =>
  on.has(key) && (NEED[key] === undefined || (counts[NEED[key]] ?? 0) > 0);

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
 */
function StoreBody({ on, sample }: { on: ReadonlySet<string>; sample: StorePageSample }) {
  const v = sample.rv;
  const ready = (key: string) => readyIn(on, sample.counts, key);
  const readPoints = on.has("read_points");
  const reactions = on.has("reactions");
  return (
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
      {ready("posts") && (
        <div className="salon-posts mt-8" data-cap="posts">
          <h2 className="member-eyebrow text-xs font-medium tracking-[0.12em] text-muted-foreground mb-3">
            お店からのお知らせ{readPoints && <small>読むとポイントがたまります</small>}
          </h2>
          <div className="member-rows bg-card divide-y divide-border/60">
            {v.posts.map((post) => (
              <a key={post.t} className="flex items-center gap-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
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
    </div>
  );
}

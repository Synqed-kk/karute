'use client'
// Verified port of Synqed-kk/reserve @ c2a9f9543187 (2026-09-23 20:52 JST) — the member card's
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
// - i18n keys are printed as the Japanese Reserve's ja/member.json holds at c2a9f95.
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
// - The cover's no-store branch is ported (Reserve's `store ? … : …`): an empty storeLine prints the category
//   and 「いつでもご予約いただけます」 in the same two <p>s. The category is fixed to GENERIC 「お店」 because the
//   port carries no business type. Fallback branch: same markup as Reserve, not pixel-proven (no store-less
//   case in the harness set).
// - The first chip's crown drops Reserve's rank gate (`me.salons.some(… && salon.rank)`): the port's sample
//   member is ranked and the port carries no membership data, so the crown always shows on the first chip.
import { useLayoutEffect, useRef, useState } from "react";

import { memberTenantVars, type BrandTheme } from "./member-card-vars";
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
}

// The demo member Reserve's mock shows at c2a9f95 (src/lib/mock.ts + ja/member.json), frozen on the
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
function ChevronRight({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-right" aria-hidden="true">
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

// reserve src/components/customer/membership-date.tsx:1–6 @ c2a9f95, verbatim
/** Shared date markup from the approved mock; the weekday keeps its smaller size. */
export function MembershipDate({ value }: { value: string }) {
  return <>{value.split(/(（[^）]*）)/).map((part, index) =>
    part.startsWith('（') ? <span className="membership-weekday" key={index}>{part}</span> : part
  )}</>;
}

export function ReserveCardPreview({ name, storeLine, cardColor, primaryColor, address, view }: ReserveCardPreviewProps) {
  // Reserve's MembershipCard/TenantCard/StudioCover each take `memberTenantVars(theme)`; the theme here is
  // the two colours the caller owns. The same vars also sit on the root (packet): custom properties inherit.
  const theme: BrandTheme = { cardColor: cardColor ?? undefined, primaryColor };
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
        <StudioCover tenant={tenant} storeLine={storeLine} address={address} theme={theme} />
      )}
    </div>
  );
}

/** reserve studio-home.tsx MembershipCard (359–517) — the card block, static. */
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
  // studio-home.tsx:417–455 @ c2a9f95, verbatim
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
        {storeLine && (
          <span className="mcard__store" data-morph-branch>
            {storeLine}
          </span>
        )}
        {/* studio-home.tsx NextVisitBody (621–626), static */}
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

/** reserve studio-home.tsx TenantCard (648–682) — the small card, static. */
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

/** reserve studio-salon.tsx StudioCover (37–231) — the cover, static. */
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
  // studio-salon.tsx:56–102 @ c2a9f95, verbatim
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
        {storeLine ? (
          <>
            <p className="salon-cover__st" data-morph-branch>
              {storeLine}
            </p>
            {address && (
              <p className="salon-cover__ad" data-morph-hide>
                {address.replace(/\s+(?=[A-Z])/, "\n").split("\n").map((line, index) => <span key={index} className="block">{line}</span>)}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="salon-cover__st" data-morph-branch>
              {SAMPLE.coverCategory}
            </p>
            <p className="salon-cover__ad" data-morph-hide>
              {SAMPLE.smallLine}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import { APP_NAME, FIRM_NAME } from "@/lib/brand";

/**
 * The Big Fish Recruitment mark (the fish from the logo, in its teal and
 * aqua) with the wordmark in thin capitals, as the logo sets it. Used in
 * the header and on the sign-in page; the favicon is the same fish.
 */
export function BrandFish({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="hsl(var(--brand-teal))" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20 L18 32 L4 44" />
        <path d="M10 32 L44 12 L44 52 Z" fill="hsl(var(--brand-aqua))" />
        <path d="M44 12 L54 15 L54 49 L44 52 Z" fill="hsl(var(--brand-teal-mid))" />
        <path d="M52 14 Q64 22 60 30" />
        <path d="M52 50 Q64 42 60 34" />
        <path d="M36 16 L40 8" />
        <path d="M36 48 L40 56" />
      </g>
    </svg>
  );
}

export function BrandMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${FIRM_NAME}, ${APP_NAME}`}>
      <BrandFish className={big ? "h-12 w-12" : "h-9 w-9"} />
      <span className="flex flex-col leading-none">
        <span className={`font-light uppercase tracking-[0.28em] text-[hsl(var(--brand-teal))] ${big ? "text-lg" : "text-sm"}`}>Big Fish</span>
        <span className={`font-light uppercase tracking-[0.22em] text-[hsl(var(--brand-teal-mid))] ${big ? "text-[10px]" : "text-[8px]"}`}>Recruitment</span>
      </span>
    </span>
  );
}

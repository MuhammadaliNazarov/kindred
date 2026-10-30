import clsx from "clsx";

/** Kindred mark: two overlapping rings (you and the person who can introduce you) + wordmark. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className={className}>
      <circle cx="15" cy="20" r="10" stroke="#ffffff" strokeWidth="3.2" />
      <circle cx="25" cy="20" r="10" stroke="#5b7cff" strokeWidth="3.2" />
    </svg>
  );
}

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span className="font-display text-[16px] font-semibold tracking-[-0.02em] text-white">Kindred</span>
    </span>
  );
}

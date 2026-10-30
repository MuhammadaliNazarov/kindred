import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "success";

/**
 * Button scale (DESIGN-SYSTEM.md, "Buttons"). One primary per view, top right of the page header.
 * Exported as a class helper too, so links (`next/link`) can share the exact same look.
 */
export function buttonClass(variant: ButtonVariant = "secondary", className?: string) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-medium tracking-[-0.005em]",
    "transition-[transform,background-color,box-shadow,color] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
    variant === "primary" &&
      "h-10 bg-accent px-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(47,91,255,0.3)] hover:bg-accent-hover hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_6px_20px_-6px_rgba(47,91,255,0.5)]",
    variant === "secondary" && "h-9 border border-neutral-200 bg-white px-4 text-neutral-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-[#f3f5fa]",
    variant === "ghost" && "h-8 px-3 text-neutral-600 hover:bg-black/[0.04] hover:text-neutral-950",
    variant === "success" &&
      "h-9 bg-emerald-600 px-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(4,120,87,0.3)] hover:bg-emerald-700",
    className,
  );
}

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...rest} />;
}

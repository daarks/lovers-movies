import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  variant?: "default" | "accent" | "gold" | "soft";
  icon?: ReactNode;
  children?: ReactNode;
}

export function Chip({ active, variant = "default", icon, className, children, type, ...rest }: ChipProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        "rx-chip",
        variant === "accent" && "rx-chip--accent",
        variant === "gold" && "rx-chip--gold",
        variant === "soft" && "rx-chip--soft",
        active && "rx-chip--active",
        className
      )}
      aria-pressed={active}
      {...rest}
    >
      {icon ? <span aria-hidden="true" style={{ display: "inline-flex" }}>{icon}</span> : null}
      {children}
    </button>
  );
}

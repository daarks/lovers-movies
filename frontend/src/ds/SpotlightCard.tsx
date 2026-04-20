import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface SpotlightCardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  as?: "div" | "a" | "article" | "button";
}

/**
 * Card com spotlight reagindo ao mouse. O efeito é controlado por
 * --rx-spot-x/--rx-spot-y via onMouseMove (CSS puro; barato).
 */
export function SpotlightCard({ className, children, onMouseMove, as = "div", ...rest }: SpotlightCardProps) {
  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--rx-spot-x", `${e.clientX - rect.left}px`);
    target.style.setProperty("--rx-spot-y", `${e.clientY - rect.top}px`);
    onMouseMove?.(e);
  }
  const Tag = as as "div";
  return (
    <Tag
      className={cx("rx-spotlight rx-surface", className)}
      onMouseMove={handleMove}
      {...(rest as HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </Tag>
  );
}

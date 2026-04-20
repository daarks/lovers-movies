import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface ShinyTextProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
}

export function ShinyText({ className, children, ...rest }: ShinyTextProps) {
  return (
    <span className={cx("rx-shiny-text", className)} {...rest}>
      {children}
    </span>
  );
}

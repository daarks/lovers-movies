import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface MarqueeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  duplicate?: boolean;
}

export function Marquee({ children, duplicate = true, className, ...rest }: MarqueeProps) {
  return (
    <div className={cx("rx-marquee", className)} {...rest}>
      <div className="rx-marquee-track">
        {children}
        {duplicate ? <span aria-hidden="true" className="rx-marquee-track-clone">{children}</span> : null}
      </div>
    </div>
  );
}

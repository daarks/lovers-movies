import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "full";
}

export function Skeleton({ width, height, rounded = "md", className, style, ...rest }: SkeletonProps) {
  return (
    <div
      className={cx("rx-skeleton", className)}
      style={{
        width,
        height,
        borderRadius:
          rounded === "full"
            ? 9999
            : rounded === "lg"
            ? "var(--rx-radius-lg)"
            : rounded === "sm"
            ? "var(--rx-radius-xs)"
            : "var(--rx-radius-sm)",
        ...style,
      }}
      {...rest}
    />
  );
}

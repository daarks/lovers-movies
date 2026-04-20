import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface GradientTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: ElementType;
  size?: "md" | "lg" | "xl" | "display";
  variant?: "primary" | "gold" | "rose";
  shiny?: boolean;
  children?: ReactNode;
}

export function GradientTitle({
  as,
  size = "lg",
  variant = "primary",
  shiny = false,
  className,
  children,
  ...rest
}: GradientTitleProps) {
  const Tag = (as ?? "h1") as ElementType;
  return (
    <Tag
      className={cx(
        "rx-title",
        size === "display" && "rx-title--display",
        size === "xl" && "rx-title--xl",
        size === "lg" && "rx-title--lg",
        size === "md" && "rx-title--md",
        shiny
          ? "rx-shiny-text"
          : variant === "gold"
          ? "rx-gradient-text--gold"
          : variant === "rose"
          ? "rx-gradient-text--rose"
          : "rx-gradient-text",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

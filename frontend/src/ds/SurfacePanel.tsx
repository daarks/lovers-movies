import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "plate" | "shell" | "elevated" | "hero";

export interface SurfacePanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  glow?: boolean;
  aura?: boolean;
  as?: "div" | "section" | "article" | "aside";
  children?: ReactNode;
}

/**
 * Painel Liquid Glass. `variant="hero"` aplica o gradiente principal da página.
 * `aura` adiciona dois orbs borrados no fundo para sensação de profundidade.
 */
export function SurfacePanel({
  variant = "plate",
  glow = false,
  aura = false,
  className,
  children,
  as: Tag = "div",
  ...rest
}: SurfacePanelProps) {
  return (
    <Tag
      className={cx(
        "rx-surface",
        variant === "shell" && "rx-surface--shell",
        variant === "elevated" && "rx-surface--elevated",
        variant === "hero" && "rx-surface--hero",
        glow && "rx-surface--glow",
        className
      )}
      {...rest}
    >
      {aura ? <span className="rx-aura" aria-hidden="true" /> : null}
      {children}
    </Tag>
  );
}

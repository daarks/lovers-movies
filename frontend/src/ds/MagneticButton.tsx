import { forwardRef, useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cx } from "./cx";

type AnchorProps = Omit<HTMLMotionProps<"a">, "children"> & { as?: "a"; href: string; children?: ReactNode };
type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & { as?: "button"; href?: undefined; children?: ReactNode };

export type MagneticButtonProps = (AnchorProps | ButtonProps) & {
  strength?: number;
  variant?: "primary" | "ghost" | "glass" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  shine?: boolean;
};

/**
 * Botão magnético: o conteúdo é puxado suavemente em direção ao cursor.
 * Desativa-se em prefers-reduced-motion.
 */
export const MagneticButton = forwardRef<HTMLElement, MagneticButtonProps>(function MagneticButton(
  { className, strength = 22, variant = "primary", size = "md", block = false, shine = true, children, onMouseMove, onMouseLeave, ...rest },
  forwardedRef
) {
  const localRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 300, damping: 20, mass: 0.4 });
  const sy = useSpring(my, { stiffness: 300, damping: 20, mass: 0.4 });

  function handleMove(e: React.MouseEvent) {
    onMouseMove?.(e as never);
    if (reduced || !localRef.current) return;
    const rect = localRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * strength;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * strength;
    mx.set(x);
    my.set(y);
  }
  function handleLeave(e: React.MouseEvent) {
    onMouseLeave?.(e as never);
    mx.set(0);
    my.set(0);
  }

  const classes = cx(
    "rx-btn",
    variant === "primary" && "rx-btn--primary",
    variant === "ghost" && "rx-btn--ghost",
    variant === "glass" && "rx-btn--glass",
    variant === "danger" && "rx-btn--danger",
    variant === "success" && "rx-btn--success",
    size === "sm" && "rx-btn--sm",
    size === "lg" && "rx-btn--lg",
    block && "rx-btn--block",
    shine && "rx-btn--shine",
    className
  );

  if ("href" in rest && rest.href !== undefined) {
    const anchorProps = rest as AnchorProps;
    return (
      <motion.a
        ref={(el: HTMLAnchorElement | null) => {
          localRef.current = el;
          if (typeof forwardedRef === "function") forwardedRef(el);
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLElement | null>).current = el;
        }}
        className={classes}
        style={{ x: sx, y: sy }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        {...anchorProps}
      >
        <span>{children}</span>
      </motion.a>
    );
  }

  const buttonProps = rest as ButtonProps;
  return (
    <motion.button
      ref={(el: HTMLButtonElement | null) => {
        localRef.current = el;
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLElement | null>).current = el;
      }}
      className={classes}
      style={{ x: sx, y: sy }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      {...buttonProps}
    >
      <span>{children}</span>
    </motion.button>
  );
});

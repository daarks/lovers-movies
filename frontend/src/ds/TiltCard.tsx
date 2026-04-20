import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cx } from "./cx";

export type TiltCardProps = Omit<HTMLMotionProps<"div">, "children"> & {
  maxTilt?: number;
  scale?: number;
  glare?: boolean;
  children?: ReactNode;
};

/**
 * Card 3D com tilt baseado na posição do mouse. Glare opcional.
 */
export function TiltCard({ maxTilt = 9, scale = 1.02, glare = true, className, children, ...rest }: TiltCardProps) {
  const reduced = useReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const sx = useSpring(rx, { stiffness: 180, damping: 18, mass: 0.4 });
  const sy = useSpring(ry, { stiffness: 180, damping: 18, mass: 0.4 });
  const glareX = useTransform(ry, (v) => `${50 + (v / maxTilt) * 20}%`);
  const glareY = useTransform(rx, (v) => `${50 - (v / maxTilt) * 20}%`);
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduced || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rx.set(-(py - 0.5) * maxTilt * 2);
    ry.set((px - 0.5) * maxTilt * 2);
  }
  function onLeave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={cx("rx-tilt-card", className)}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        rotateX: sx,
        rotateY: sy,
        transformStyle: "preserve-3d",
        transformPerspective: 1000,
      }}
      whileHover={reduced ? undefined : { scale }}
      transition={{ type: "spring", stiffness: 180, damping: 18 }}
      {...rest}
    >
      {children}
      {glare && !reduced ? (
        <motion.span
          aria-hidden="true"
          className="rx-tilt-glare"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: "inherit",
            background: "radial-gradient(280px circle at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,0.18), transparent 55%)",
            mixBlendMode: "screen",
            ["--gx" as string]: glareX,
            ["--gy" as string]: glareY,
          } as React.CSSProperties}
        />
      ) : null}
    </motion.div>
  );
}

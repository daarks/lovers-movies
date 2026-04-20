import type { ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { cx } from "./cx";

export interface PageHeroProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  tagline?: ReactNode;
  actions?: ReactNode;
  backdrop?: string;
  accentTheme?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Hero premium com backdrop parallax, gradientes de mesh e eyebrow.
 * `accentTheme` aplica data-rx-theme para trocar o accent da página.
 */
export function PageHero({
  eyebrow,
  title,
  tagline,
  actions,
  backdrop,
  accentTheme,
  className,
  children,
}: PageHeroProps) {
  const reduced = useReducedMotion();
  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, reduced ? 0 : 80]);
  const scale = useTransform(scrollY, [0, 400], [1, reduced ? 1 : 1.08]);

  return (
    <section
      className={cx("rx-page-hero", className)}
      data-rx-theme={accentTheme}
    >
      {backdrop ? (
        <motion.div className="rx-page-hero-backdrop" style={{ y: bgY, scale }} aria-hidden="true">
          <img src={backdrop} alt="" loading="eager" />
        </motion.div>
      ) : null}
      <span className="rx-page-hero-mesh" aria-hidden="true" />
      <span className="rx-page-hero-vignette" aria-hidden="true" />
      <div className="rx-page-hero-inner">
        {eyebrow ? <p className="rx-eyebrow rx-page-hero-eyebrow">{eyebrow}</p> : null}
        <h1 className="rx-page-hero-title">{title}</h1>
        {tagline ? <p className="rx-page-hero-tagline">{tagline}</p> : null}
        {actions ? <div className="rx-page-hero-actions">{actions}</div> : null}
        {children}
      </div>
    </section>
  );
}

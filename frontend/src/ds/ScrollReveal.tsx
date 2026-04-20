import type { ReactNode } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cx } from "./cx";

export type ScrollRevealProps = Omit<HTMLMotionProps<"div">, "children"> & {
  delay?: number;
  y?: number;
  blur?: boolean;
  children?: ReactNode;
};

export function ScrollReveal({ delay = 0, y = 28, blur = true, className, children, ...rest }: ScrollRevealProps) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <div className={className} {...(rest as unknown as React.HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={cx(className)}
      initial={{ opacity: 0, y, filter: blur ? "blur(6px)" : undefined }}
      whileInView={{ opacity: 1, y: 0, filter: blur ? "blur(0px)" : undefined }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 0.61, 0.36, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

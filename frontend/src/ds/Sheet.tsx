import { Dialog } from "@base-ui-components/react/dialog";
import type { ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cx } from "./cx";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  side?: "bottom" | "right";
  children?: ReactNode;
  maxWidth?: number;
  dismissOnBackdrop?: boolean;
  className?: string;
}

/**
 * Bottom sheet (mobile-first) sobre Base UI Dialog + framer-motion.
 * Usa spring transitions e respeita prefers-reduced-motion.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  side = "bottom",
  children,
  maxWidth,
  className,
}: SheetProps) {
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={
                <motion.div
                  className="rx-sheet-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                />
              }
            />
            <Dialog.Popup
              render={
                <motion.div
                  className={cx("rx-sheet", side === "right" && "rx-sheet--right", className)}
                  initial={reduced ? { opacity: 0 } : side === "right" ? { x: "100%" } : { y: "100%" }}
                  animate={reduced ? { opacity: 1 } : side === "right" ? { x: 0 } : { y: 0 }}
                  exit={reduced ? { opacity: 0 } : side === "right" ? { x: "100%" } : { y: "100%" }}
                  transition={{ type: "spring", stiffness: 260, damping: 30, mass: 0.6 }}
                  style={{ maxWidth }}
                />
              }
            >
              {title ? (
                <header className="rx-sheet-head">
                  <div>
                    <Dialog.Title className="rx-sheet-title">{title}</Dialog.Title>
                    {subtitle ? <Dialog.Description className="rx-sheet-subtitle">{subtitle}</Dialog.Description> : null}
                  </div>
                  <Dialog.Close className="rx-sheet-close" aria-label="Fechar">
                    ×
                  </Dialog.Close>
                </header>
              ) : null}
              <div className="rx-sheet-body">{children}</div>
            </Dialog.Popup>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

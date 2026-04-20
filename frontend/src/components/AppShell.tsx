import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ToastProvider, useToast } from "../ds/Toast";

/**
 * Magnetic indicator that follows the active bottom-nav link, with spring transition.
 */
function BottomNavIndicator() {
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    if (!nav) return;

    const compute = () => {
      const active = nav.querySelector<HTMLElement>(".bottom-nav-link.is-active")
        || nav.querySelector<HTMLElement>(".bottom-nav-link[aria-current='page']")
        || null;
      if (!active) {
        setRect(null);
        return;
      }
      const navBox = nav.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      setRect({ left: box.left - navBox.left, width: box.width });
    };

    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(nav);
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    const mo = new MutationObserver(compute);
    mo.observe(nav, { attributes: true, subtree: true, attributeFilter: ["class", "aria-current"] });

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, []);

  const nav = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".bottom-nav") : null;
  if (!nav || !rect) return null;

  return createPortal(
    <motion.span
      aria-hidden="true"
      className="bottom-nav-indicator"
      animate={{ left: rect.left, width: rect.width }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
      initial={false}
    />,
    nav
  );
}

/**
 * Enhance the existing server-rendered nav drawer with framer-motion transitions.
 * Keeps the markup intact for JS-off fallback; only animates when React mounts.
 */
function DrawerEnhancer() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const drawer = document.getElementById("app-drawer");
    if (!drawer) return;

    const detect = () => {
      const isOpen = document.body.classList.contains("nav-drawer-open");
      setOpen(isOpen);
    };

    detect();
    const mo = new MutationObserver(detect);
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const drawer = document.getElementById("app-drawer");
    const backdrop = document.getElementById("nav-drawer-backdrop");
    if (!drawer || !backdrop) return;

    if (reduce) return;

    if (open) {
      drawer.style.transform = "translateX(0)";
      drawer.style.transition = "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)";
      backdrop.style.opacity = "1";
      backdrop.style.transition = "opacity 240ms ease";
    } else {
      drawer.style.transform = "translateX(-100%)";
      drawer.style.transition = "transform 240ms cubic-bezier(0.4, 0, 0.2, 1)";
      backdrop.style.opacity = "0";
      backdrop.style.transition = "opacity 200ms ease";
    }
  }, [open, reduce]);

  return null;
}

/**
 * Bridge window.showAppToast / CustomEvent('app:toast') to React Toast system.
 */
function ToastBridge() {
  const { toast } = useToast();

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      toast({
        title: detail.title || detail.message || "",
        description: detail.description,
        kind: detail.kind || detail.tone || "info",
        duration: detail.duration,
      });
    };
    window.addEventListener("app:toast", handler as EventListener);

    const legacy = (msg: string, kind?: string) => {
      const normKind = kind === "error" || kind === "err"
        ? "error"
        : kind === "success" || kind === "ok"
          ? "success"
          : kind === "accent"
            ? "accent"
            : "info";
      toast({ title: String(msg || ""), kind: normKind as any });
    };
    const prev = (window as any).showAppToast;
    (window as any).showAppToast = legacy;

    return () => {
      window.removeEventListener("app:toast", handler as EventListener);
      (window as any).showAppToast = prev;
    };
  }, [toast]);

  return null;
}

export default function AppShell() {
  const reduce = useReducedMotion();
  const mountsReady = useMemo(() => typeof document !== "undefined", []);

  if (!mountsReady) return null;

  return (
    <ToastProvider>
      <BottomNavIndicator />
      <DrawerEnhancer />
      <ToastBridge />
      <AnimatePresence>
        {reduce ? null : (
          <motion.span
            key="chrome-ready"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "fixed", pointerEvents: "none" }}
          />
        )}
      </AnimatePresence>
    </ToastProvider>
  );
}

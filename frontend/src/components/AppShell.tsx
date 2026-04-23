import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ToastProvider, useToast } from "../ds/Toast";
import { appUrl } from "../lib/appBase";

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

/** Botão "Instalar app" no drawer: usa beforeinstallprompt (Android/Chrome/Edge desktop)
 *  e, em iOS Safari, mostra um toast explicando o fluxo manual (Compartilhar → Tela de início). */
function InstallPromptBridge() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const item = document.getElementById("nav-drawer-install-item");
    const btn = document.getElementById("nav-drawer-install-btn") as HTMLButtonElement | null;
    if (!item || !btn) return;

    type BIPEvent = Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    let deferred: BIPEvent | null = null;

    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;

    const ua = navigator.userAgent || "";
    const isIOSSafari = /iP(hone|od|ad)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);

    const show = () => {
      item.hidden = false;
      btn.disabled = false;
    };
    const hide = () => {
      item.hidden = true;
    };

    if (isStandalone) {
      hide();
      return;
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      deferred = e as BIPEvent;
      show();
    };

    const onInstalled = () => {
      deferred = null;
      hide();
      toastRef.current({ title: "App instalado!", kind: "success" });
    };

    const onClick = async () => {
      if (deferred) {
        try {
          btn.disabled = true;
          await deferred.prompt();
          const choice = await deferred.userChoice;
          if (choice.outcome !== "accepted") {
            btn.disabled = false;
          } else {
            hide();
          }
        } catch {
          btn.disabled = false;
        } finally {
          deferred = null;
        }
        return;
      }
      if (isIOSSafari) {
        toastRef.current({
          title: "Para instalar no iPhone",
          description: "Toque em Compartilhar e depois 'Adicionar à Tela de Início'.",
          kind: "info",
          duration: 7000,
        });
        return;
      }
      toastRef.current({
        title: "Instalação não disponível agora",
        description: "Abra o site no Chrome ou Edge e navegue um pouco antes — só depois disso o navegador costuma liberar a instalação.",
        kind: "info",
        duration: 6000,
      });
    };

    window.addEventListener("beforeinstallprompt", onBIP as EventListener);
    window.addEventListener("appinstalled", onInstalled);
    btn.addEventListener("click", onClick);

    if (isIOSSafari) show();

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
      btn.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}

/** SSE do casal: match fora da página de swipe e evento "assistindo". */
function CoupleEventStreamBridge() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const path = ((typeof window !== "undefined" && window.location.pathname) || "").replace(/\/$/, "") || "/";
    if (path === "/bem-vindo") return undefined;
    // Na página de swipe já existe EventSource da sessão; um segundo SSE no mesmo host
    // pode saturar o worker monothread do Flask dev ou apertar threads do Gunicorn.
    if (path === "/casal") return undefined;

    const stored = (localStorage.getItem("movies_app_active_profile_slug") || "a").toLowerCase();
    const profile = stored === "b" ? "b" : "a";
    let es: EventSource | null = null;
    let cancelled = false;
    let attempt = 0;
    let timer: number | null = null;

    const labelA = () => document.body.getAttribute("data-profile-label-a") || "A";
    const labelB = () => document.body.getAttribute("data-profile-label-b") || "B";

    const showMatchToast = (title: string) => {
      const p = (window.location.pathname || "").replace(/\/$/, "") || "/";
      if (p === "/casal") return;
      toastRef.current({
        title: `Match! Vocês dois querem assistir ${title || "…"}`,
        kind: "success",
      });
    };

    const showWatchingToast = (slug: string, title: string) => {
      const name = slug === "b" ? labelB() : labelA();
      window.dispatchEvent(
        new CustomEvent("app:toast", {
          detail: {
            title: `${name} começou a assistir ${title}`,
            description: "Era pra ser juntos? 👀",
            kind: "info",
          },
        })
      );
    };

    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const open = () => {
      if (cancelled) return;
      clearTimer();
      const url = appUrl(`/api/couple/stream?profile=${encodeURIComponent(profile)}`);
      es = new EventSource(url);
      es.onopen = () => {
        attempt = 0;
      };
      es.onmessage = (e) => {
        try {
          const j = JSON.parse(e.data) as { type?: string; title?: string; profile?: string };
          if (j.type === "match") showMatchToast(String(j.title || ""));
          if (j.type === "watching") {
            showWatchingToast(String(j.profile || "a").toLowerCase(), String(j.title || ""));
          }
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        es = null;
        if (cancelled) return;
        attempt += 1;
        const delayMs = Math.min(30000, 1000 * 2 ** Math.min(attempt - 1, 5));
        timer = window.setTimeout(open, delayMs);
      };
    };

    open();
    return () => {
      cancelled = true;
      clearTimer();
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

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
      <InstallPromptBridge />
      <CoupleEventStreamBridge />
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

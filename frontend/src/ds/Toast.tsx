import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cx } from "./cx";

export type ToastKind = "info" | "success" | "error" | "accent";

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  kind?: ToastKind;
  duration?: number;
}

interface ToastCtx {
  toast: (t: Omit<ToastItem, "id">) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => [...prev, { id, kind: t.kind ?? "info", duration: t.duration ?? 3200, ...t }]);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((it) =>
      setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== it.id));
      }, it.duration ?? 3200)
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [items]);

  const ctx = useMemo(() => ({ toast: push }), [push]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <div className="rx-toast-host" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.div
              key={it.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className={cx("rx-toast", `rx-toast--${it.kind}`)}
              role="status"
            >
              <strong className="rx-toast-title">{it.title}</strong>
              {it.description ? <p className="rx-toast-desc">{it.description}</p> : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

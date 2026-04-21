import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import {
  GradientTitle,
  MagneticButton,
  NumberTicker,
  ScrollReveal,
  SurfacePanel,
} from "../ds";
import { appUrl } from "../lib/appBase";

interface DayItem {
  id?: number;
  tmdb_id?: number;
  title?: string;
  poster_path?: string | null;
  media_type?: string;
}

type ByDay = Record<string, DayItem[]>;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function posterUrl(path: string | null | undefined, size = "w185") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function MosaicCell({ items }: { items: DayItem[] }) {
  const n = items.length;
  if (n === 0) {
    return (
      <div className="cal-empty" aria-hidden="true">
        <span className="cal-empty-face">:-)</span>
      </div>
    );
  }
  if (n === 1) {
    return (
      <div className="cal-mosaic cal-mosaic--1">
        <PosterSlot item={items[0]} variant="hero" />
      </div>
    );
  }
  if (n === 2) {
    return (
      <div className="cal-mosaic cal-mosaic--2">
        <PosterSlot item={items[0]} variant="hero" />
        <PosterSlot item={items[1]} variant="hero" />
      </div>
    );
  }
  if (n === 3) {
    return (
      <div className="cal-mosaic cal-mosaic--3">
        <PosterSlot item={items[0]} variant="hero" />
        <div className="cal-mosaic-stack">
          <PosterSlot item={items[1]} variant="thumb" />
          <PosterSlot item={items[2]} variant="thumb" />
        </div>
      </div>
    );
  }
  const extra = n > 4 ? n - 4 : 0;
  return (
    <div className="cal-mosaic cal-mosaic--4">
      <PosterSlot item={items[0]} variant="hero" />
      <div className="cal-mosaic-stack">
        <PosterSlot item={items[1]} variant="thumb" />
        <PosterSlot item={items[2]} variant="thumb" />
        <PosterSlot item={items[3]} variant="thumb" />
      </div>
      {extra > 0 && <span className="cal-more">+{extra}</span>}
    </div>
  );
}

function PosterSlot({ item, variant }: { item: DayItem; variant: "hero" | "thumb" }) {
  const src = item.poster_path ? posterUrl(item.poster_path, variant === "hero" ? "w185" : "w154") : "";
  if (!src) {
    return (
      <div className={`cal-mosaic-slot cal-mosaic-slot--${variant} cal-mini-ph`} aria-hidden="true">
        🎬
      </div>
    );
  }
  return (
    <div className={`cal-mosaic-slot cal-mosaic-slot--${variant}`}>
      <img src={src} alt="" loading="lazy" />
    </div>
  );
}

export default function CalendarApp() {
  const today = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({
    y: today.getFullYear(),
    m: today.getMonth() + 1,
  });
  const [byDay, setByDay] = useState<ByDay>({});
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState(0);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.removeAttribute("aria-busy");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(appUrl(`/api/daily-watch?m=${monthKey(ym.y, ym.m)}`))
      .then((r) => r.json())
      .then((data: { by_day?: ByDay }) => {
        if (cancelled) return;
        setByDay(data.by_day || {});
      })
      .catch(() => {
        if (!cancelled) setByDay({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ym]);

  function shift(delta: number) {
    setDirection(delta);
    setYm((prev) => {
      let m = prev.m + delta;
      let y = prev.y;
      if (m < 1) {
        m = 12;
        y -= 1;
      }
      if (m > 12) {
        m = 1;
        y += 1;
      }
      return { y, m };
    });
  }

  const monthLabel = useMemo(() => {
    const date = new Date(ym.y, ym.m - 1, 1);
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [ym]);

  const stats = useMemo(() => {
    const totalDays = Object.keys(byDay).length;
    const totalItems = Object.values(byDay).reduce((acc, arr) => acc + arr.length, 0);
    return { totalDays, totalItems };
  }, [byDay]);

  const days: Array<{ day: number; key: string; items: DayItem[]; padStart: number } | null> = useMemo(() => {
    const firstDow = new Date(ym.y, ym.m - 1, 1).getDay();
    const dim = daysInMonth(ym.y, ym.m);
    const out: Array<{ day: number; key: string; items: DayItem[]; padStart: number } | null> = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    const mKey = monthKey(ym.y, ym.m);
    for (let d = 1; d <= dim; d++) {
      const key = `${mKey}-${String(d).padStart(2, "0")}`;
      out.push({ day: d, key, items: byDay[key] || [], padStart: firstDow });
    }
    return out;
  }, [ym, byDay]);

  return (
    <div ref={rootRef} className="cal-root">
      <ScrollReveal>
        <section className="cal-hero">
          <div className="cal-hero-aura" aria-hidden="true" />
          <div className="cal-hero-inner">
            <span className="cal-hero-eyebrow">
              <CalendarDays size={14} /> Nosso cinema
            </span>
            <h1 className="cal-hero-title">
              <GradientTitle as="span" size="xl">
                Assistimos hoje
              </GradientTitle>
            </h1>
            <p className="cal-hero-sub">
              Um mapa visual das noites do casal. Toque num dia para registrar filmes ou episódios.
            </p>
            <div className="cal-hero-stats">
              <div className="cal-hero-stat">
                <span className="cal-hero-stat-value">
                  <NumberTicker value={stats.totalItems} />
                </span>
                <span className="cal-hero-stat-label">Títulos no mês</span>
              </div>
              <div className="cal-hero-stat">
                <span className="cal-hero-stat-value">
                  <NumberTicker value={stats.totalDays} />
                </span>
                <span className="cal-hero-stat-label">Dias com sessões</span>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <SurfacePanel className="cal-toolbar">
        <button
          type="button"
          className="cal-nav-btn"
          onClick={() => shift(-1)}
          aria-label="Mês anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="cal-toolbar-month" aria-live="polite">
          <span className="cal-toolbar-eyebrow">
            <Sparkles size={12} /> Mês atual
          </span>
          <strong className="cal-toolbar-title">{monthLabel}</strong>
        </div>
        <button
          type="button"
          className="cal-nav-btn"
          onClick={() => shift(1)}
          aria-label="Próximo mês"
        >
          <ChevronRight size={18} />
        </button>
      </SurfacePanel>

      <div className="cal-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={monthKey(ym.y, ym.m)}
          className="cal-cells"
          aria-busy={loading}
          custom={direction}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction === 0 ? 0 : direction * 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction === 0 ? 0 : -direction * 30 }}
          transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
          drag={reduce ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (info.offset.x < -80) shift(1);
            else if (info.offset.x > 80) shift(-1);
          }}
        >
          {days.map((d, idx) =>
            d === null ? (
              <div key={`pad-${idx}`} className="cal-cell cal-cell--pad" aria-hidden="true" />
            ) : (
              <a
                key={d.key}
                className={`cal-cell cal-cell--link ${d.items.length ? "cal-cell--has" : "cal-cell--empty-day"}`}
                href={`/assistimos-hoje/dia/${d.key}`}
                aria-label={`Dia ${d.day}, ${d.items.length} título(s)`}
                data-day={d.key}
              >
                <span className="cal-day-num" aria-hidden="true">
                  {d.day}
                </span>
                <MosaicCell items={d.items} />
                {d.items.length > 1 && (
                  <span className="cal-count-badge" aria-hidden="true">
                    {d.items.length}
                  </span>
                )}
                {d.items.length === 0 && (
                  <span className="cal-add-hint" aria-hidden="true">
                    <Plus size={14} />
                  </span>
                )}
              </a>
            )
          )}
        </motion.div>
      </AnimatePresence>

      <div className="cal-foot">
        <MagneticButton
          as="a"
          href={`/assistimos-hoje/dia/${monthKey(ym.y, ym.m)}-${String(today.getDate()).padStart(2, "0")}`}
          variant="primary"
        >
          <CalendarDays size={16} /> Registrar hoje
        </MagneticButton>
      </div>
    </div>
  );
}

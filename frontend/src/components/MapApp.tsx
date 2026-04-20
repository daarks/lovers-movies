import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { Globe, Search, Compass, MapPin, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import {
  GradientTitle,
  NumberTicker,
  ScrollReveal,
  SurfacePanel,
  Sheet,
  EmptyState,
  Skeleton,
  Chip,
} from "../ds";

interface CountryTitle {
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path?: string | null;
}

interface CountryRow {
  iso: string;
  count: number;
  label_pt?: string;
  path_ids?: string[];
  titles?: CountryTitle[];
}

function posterUrl(path?: string | null) {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/w154${path}`;
}

function tierColor(count: number, max: number) {
  if (count <= 0 || max <= 0) return "var(--mapa-idle)";
  const ratio = Math.min(1, count / max);
  const hue = 280 - ratio * 80;
  const light = 55 - ratio * 18;
  return `hsl(${hue}, 85%, ${light}%)`;
}

export default function MapApp() {
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [svgText, setSvgText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<CountryRow | null>(null);
  const svgWrapRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const sx = useSpring(panX, { stiffness: 260, damping: 32 });
  const sy = useSpring(panY, { stiffness: 260, damping: 32 });

  const panStart = useRef<{ x: number; y: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/map/countries").then((r) => r.json()),
      fetch("/static/world-countries.svg").then((r) => r.text()),
    ])
      .then(([data, svg]) => {
        setCountries(data?.countries || []);
        setSvgText(svg);
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, []);

  const maxCount = useMemo(() => countries.reduce((m, c) => Math.max(m, c.count || 0), 0), [countries]);

  const pathToCountry = useMemo(() => {
    const map = new Map<string, CountryRow>();
    countries.forEach((c) => {
      (c.path_ids || []).forEach((pid) => {
        if (pid) map.set(pid, c);
      });
    });
    return map;
  }, [countries]);

  useEffect(() => {
    if (!svgText || !svgWrapRef.current) return;
    const wrap = svgWrapRef.current;
    wrap.innerHTML = svgText;
    const svg = wrap.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;
    svg.classList.add("mapa-world-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Mapa mundial");
    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";

    countries.forEach((c) => {
      if ((c.count || 0) <= 0) return;
      const color = tierColor(c.count, maxCount);
      (c.path_ids || []).forEach((pid) => {
        if (!pid) return;
        let node: Element | null = null;
        try {
          node = svg.querySelector(`[id="${CSS.escape(pid)}"]`);
        } catch {
          node = null;
        }
        if (!node) return;
        (node as HTMLElement).style.fill = color;
        (node as HTMLElement).style.cursor = "pointer";
        node.classList.add("mapa-land--watched");
        node.setAttribute("data-map-count", String(c.count));
      });
    });

    function onClick(ev: Event) {
      const target = ev.target as HTMLElement | null;
      if (!target || !target.id) return;
      const c = pathToCountry.get(target.id);
      if (!c) return;
      setActive(c);
    }
    svg.addEventListener("click", onClick);
    return () => {
      svg.removeEventListener("click", onClick);
    };
  }, [svgText, countries, pathToCountry, maxCount]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.iso.toLowerCase().includes(q) || (c.label_pt || "").toLowerCase().includes(q)
    );
  }, [countries, search]);

  function zoom(delta: number) {
    setScale((s) => Math.min(3.5, Math.max(0.6, Number((s + delta).toFixed(2)))));
  }
  function resetView() {
    setScale(1);
    panX.set(0);
    panY.set(0);
  }

  function onPanStart(e: ReactPointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panStart.current = { x: e.clientX, y: e.clientY, origX: panX.get(), origY: panY.get() };
  }
  function onPanMove(e: ReactPointerEvent) {
    if (!panStart.current) return;
    const { x, y, origX, origY } = panStart.current;
    panX.set(origX + (e.clientX - x));
    panY.set(origY + (e.clientY - y));
  }
  function onPanEnd(e: ReactPointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    panStart.current = null;
  }

  const total = useMemo(() => countries.reduce((n, c) => n + (c.count || 0), 0), [countries]);

  return (
    <div className="map-root">
      <ScrollReveal>
        <section className="map-hero">
          <div className="map-hero-aura" aria-hidden="true" />
          <span className="map-eyebrow"><Compass size={14} /> Cinema mundial</span>
          <h1 className="map-hero-title">
            <GradientTitle as="span" size="xl">Mapa de países</GradientTitle>
          </h1>
          <p className="map-hero-sub">
            Um retrato dos países onde nasceram os filmes e séries do nosso histórico (metadados TMDB).
          </p>
          <div className="map-hero-metrics">
            <div className="map-metric">
              <span className="map-metric-icon"><Globe size={18} /></span>
              <div>
                <span className="map-metric-value"><NumberTicker value={countries.filter((c) => c.count > 0).length} /></span>
                <span className="map-metric-label">Países explorados</span>
              </div>
            </div>
            <div className="map-metric">
              <span className="map-metric-icon map-metric-icon--alt"><MapPin size={18} /></span>
              <div>
                <span className="map-metric-value"><NumberTicker value={total} /></span>
                <span className="map-metric-label">Produções catalogadas</span>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <SurfacePanel className="map-canvas-panel">
        <div className="map-canvas-toolbar">
          <button type="button" className="map-zoom-btn" onClick={() => zoom(0.25)} aria-label="Ampliar"><ZoomIn size={16} /></button>
          <button type="button" className="map-zoom-btn" onClick={() => zoom(-0.25)} aria-label="Reduzir"><ZoomOut size={16} /></button>
          <button type="button" className="map-zoom-btn" onClick={resetView} aria-label="Reiniciar"><RotateCcw size={16} /></button>
          <span className="map-zoom-readout">{Math.round(scale * 100)}%</span>
        </div>
        <div
          className="map-canvas"
          onPointerDown={onPanStart}
          onPointerMove={onPanMove}
          onPointerUp={onPanEnd}
          onPointerCancel={onPanEnd}
        >
          {loading ? (
            <Skeleton width="100%" height={340} rounded="lg" />
          ) : (
            <motion.div
              className="map-canvas-inner"
              style={{ x: sx, y: sy, scale }}
              transition={{ type: "spring", stiffness: 220, damping: 28 }}
            >
              <div ref={svgWrapRef} className="map-svg-host" />
            </motion.div>
          )}
        </div>
        <div className="map-legend">
          <span className="map-legend-label">Menos</span>
          <span className="map-legend-ramp" aria-hidden="true" />
          <span className="map-legend-label">Mais títulos</span>
        </div>
      </SurfacePanel>

      <section className="map-list-section">
        <header className="map-list-head">
          <h2 className="map-list-title"><GradientTitle as="span" size="lg">Resumo</GradientTitle></h2>
          <div className="map-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Buscar país…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>
        {filtered.length === 0 ? (
          <EmptyState title="Nenhum país no seu histórico" description="Adicione títulos no histórico para preencher o mapa." />
        ) : (
          <div className="map-chips">
            {filtered.map((c) => (
              <Chip
                key={c.iso}
                onClick={() => setActive(c)}
                variant="soft"
                active={c.count > 0}
              >
                <span className="map-chip-iso">{c.iso}</span>
                <span className="map-chip-label">{c.label_pt || c.iso}</span>
                <span className="map-chip-count">{c.count}</span>
              </Chip>
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(active)}
        onOpenChange={(o) => { if (!o) setActive(null); }}
        title={active ? (<span><MapPin size={16} /> {active.label_pt || active.iso}</span>) : null}
        subtitle={active ? `${active.count} ${active.count === 1 ? "título produzido" : "títulos produzidos"} neste país` : undefined}
      >
        {active && (
          <div className="map-sheet-body">
            {active.titles && active.titles.length > 0 ? (
              <div className="map-sheet-grid">
                {active.titles.map((t) => (
                  <a key={`${t.media_type}-${t.tmdb_id}`} className="map-sheet-card" href={`/details/${t.media_type}/${t.tmdb_id}`}>
                    {t.poster_path ? <img src={posterUrl(t.poster_path)} alt="" loading="lazy" /> : <div className="map-sheet-ph">🎬</div>}
                    <span className="map-sheet-title">{t.title}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="map-sheet-empty">Sem títulos registrados no snapshot para este país.</p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

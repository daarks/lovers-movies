import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder, useReducedMotion } from "framer-motion";
import { Filter, Search, X, Tv, Film, Clock, GripVertical, Trash2 } from "lucide-react";
import {
  Chip,
  GradientTitle,
  MagneticButton,
  MediaPoster,
  NumberTicker,
  ScrollReveal,
  SegmentedToggle,
  Sheet,
  Skeleton,
  SurfacePanel,
  cx,
} from "../ds";
import { appUrl } from "../lib/appBase";
import { apiGet } from "../lib/api";
import { GENRE_CHIPS, genresMatchFilter } from "../lib/genreMatch";
import { mediaTypeLabel } from "../lib/utils";
import type { WatchLaterItem, WatchLaterResponse } from "../lib/types";

type MediaFilter = "all" | "movie" | "tv";

const MEDIA_FILTERS = [
  { value: "all" as const, label: "Todos" },
  { value: "movie" as const, label: "Filmes", icon: <Film size={14} /> },
  { value: "tv" as const, label: "Séries", icon: <Tv size={14} /> },
];

function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function WLCard({ item, onRemove }: { item: WatchLaterItem; onRemove: (item: WatchLaterItem) => void }) {
  const reduce = useReducedMotion();
  const year = item.release_date && item.release_date.length >= 4 ? item.release_date.slice(0, 4) : "";
  return (
    <Reorder.Item
      value={item}
      as="article"
      className="wlx-card rx-cv-card"
      dragListener={false}
      whileDrag={{ scale: 1.04, zIndex: 10, rotate: -1.2, boxShadow: "0 30px 60px -20px rgba(0,0,0,0.8)" }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.95 }}
      layout
    >
      <a
        href={`/details/${item.media_type}/${item.tmdb_id}`}
        className="wlx-card-poster-link"
        aria-label={`Abrir detalhes de ${item.title}`}
      >
        <div className="wlx-card-poster">
          <MediaPoster path={item.poster_path} size="w342" title={item.title} />
        </div>
        <div className="wlx-card-hover">
          <h3 className="wlx-card-title">{item.title}</h3>
          {item.overview && <p className="wlx-card-overview">{item.overview}</p>}
          <div className="wlx-card-meta">
            {year && <span>{year}</span>}
            <Chip variant="soft" disabled icon={item.media_type === "tv" ? <Tv size={12} /> : <Film size={12} />}>
              {mediaTypeLabel(item.media_type)}
            </Chip>
          </div>
        </div>
      </a>
      <div className="wlx-card-actions">
        <ReorderDragHandle />
        <button
          type="button"
          className="wlx-card-remove"
          onClick={() => onRemove(item)}
          aria-label={`Remover ${item.title} da fila`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </Reorder.Item>
  );
}

/* Drag handle usando useDragControls via Reorder.Item não expõe controle direto com dragListener=false
 * de forma simples sem refator maior; para esta fase mantemos drag no próprio Item usando o handle da lib.
 * Abaixo um handle visual que ativa drag via pointerdown (padrão framer-motion). */
function ReorderDragHandle() {
  return (
    <span className="wlx-card-handle" aria-label="Arraste para reordenar">
      <GripVertical size={14} />
    </span>
  );
}

function WLSkeleton() {
  return (
    <div className="wlx-card wlx-card--skel">
      <Skeleton className="wlx-card-poster" style={{ aspectRatio: "2 / 3" }} />
    </div>
  );
}

export default function WatchLaterApp() {
  const [items, setItems] = useState<WatchLaterItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 220);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [genre, setGenre] = useState<string>("");
  const [filterOpen, setFilterOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<WatchLaterResponse>("/api/watch-later")
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Não foi possível carregar a fila.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    rootRef.current?.removeAttribute("aria-busy");
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = debounced.trim().toLowerCase();
    return items.filter((it) => {
      if (media !== "all" && it.media_type !== media) return false;
      if (genre && !genresMatchFilter(it.genres || "", genre)) return false;
      if (q) {
        const hay = (it.title + " " + (it.original_title || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }, [items, debounced, media, genre]);

  async function removeItem(item: WatchLaterItem) {
    if (!confirm(`Remover "${item.title}" da fila de ver depois?`)) return;
    try {
      const res = await fetch(appUrl(`/watch-later/remove/${item.id}`), {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
      } else {
        alert("Não foi possível remover. Tente novamente.");
      }
    } catch (e) {
      alert("Erro de rede.");
    }
  }

  const totalItems = items?.length ?? 0;
  const filteredCount = filtered.length;
  const filtersActive = media !== "all" || genre !== "" || query.trim() !== "";

  return (
    <div ref={rootRef} className="wlx-root hix-root">
      <ScrollReveal>
        <section className="wlx-hero hix-hero">
          <div className="wlx-hero-aura hix-hero-aura" aria-hidden="true" />
          <div className="hix-hero-inner">
            <span className="hix-hero-eyebrow">
              <Clock size={14} /> Fila do casal
            </span>
            <h1 className="hix-hero-title">
              <GradientTitle as="span" size="xl" variant="rose">
                Assistir depois
              </GradientTitle>
            </h1>
            <p className="hix-hero-sub">
              Os títulos que a gente ainda não viu, prontinhos pra próxima sessão. Arraste pra priorizar o que vem primeiro.
            </p>
            <div className="hix-hero-stats">
              <div className="hix-hero-stat">
                <span className="hix-hero-stat-value">
                  <NumberTicker value={totalItems} />
                </span>
                <span className="hix-hero-stat-label">Na fila</span>
              </div>
              <div className="hix-hero-stat">
                <span className="hix-hero-stat-value">
                  <NumberTicker value={filteredCount} />
                </span>
                <span className="hix-hero-stat-label">Exibindo</span>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <SurfacePanel className="hix-controls">
        <label className="hix-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            className="hix-search-input"
            placeholder="Buscar na fila..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar na fila"
          />
          {query && (
            <button
              type="button"
              className="hix-search-clear"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="hix-controls-right">
          <SegmentedToggle<MediaFilter>
            value={media}
            onValueChange={(v) => setMedia(v)}
            options={MEDIA_FILTERS}
            ariaLabel="Tipo de mídia"
          />
          <MagneticButton
            onClick={() => setFilterOpen(true)}
            variant="glass"
            className={cx("hix-filter-btn", filtersActive && "is-active")}
          >
            <Filter size={16} />
            <span>Filtros</span>
            {filtersActive && <span className="hix-filter-dot" aria-hidden="true" />}
          </MagneticButton>
        </div>
      </SurfacePanel>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen} title="Filtrar fila">
        <div className="hix-sheet-body">
          <section>
            <h3 className="hix-sheet-label">Gênero</h3>
            <div className="hix-chip-grid">
              {GENRE_CHIPS.map((g) => (
                <Chip
                  key={g.value || "all"}
                  variant={genre === g.value ? "accent" : "soft"}
                  active={genre === g.value}
                  icon={<span aria-hidden="true">{g.emoji}</span>}
                  onClick={() => setGenre(g.value)}
                >
                  {g.label}
                </Chip>
              ))}
            </div>
          </section>
          <div className="hix-sheet-actions">
            <button
              type="button"
              className="hix-btn-ghost"
              onClick={() => {
                setGenre("");
                setMedia("all");
                setQuery("");
              }}
            >
              Limpar tudo
            </button>
            <MagneticButton onClick={() => setFilterOpen(false)} variant="primary">
              Aplicar
            </MagneticButton>
          </div>
        </div>
      </Sheet>

      <div className="wlx-grid-wrap">
        {error && <p className="hix-error">{error}</p>}
        {!items && !error && (
          <div className="wlx-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <WLSkeleton key={i} />
            ))}
          </div>
        )}
        {items && !error && filtered.length === 0 && (
          <div className="hix-empty">
            <p>
              {totalItems === 0
                ? "Nada na fila ainda. Na página de um título, use Assistir depois."
                : "Nenhum resultado para esses filtros."}
            </p>
            {totalItems > 0 && (
              <button
                type="button"
                className="hix-btn-ghost"
                onClick={() => {
                  setGenre("");
                  setMedia("all");
                  setQuery("");
                }}
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
        {items && filtered.length > 0 && (
          <Reorder.Group
            axis="y"
            values={filtered}
            onReorder={(next) => {
              const nextIds = new Set(next.map((i) => i.id));
              const untouched = items.filter((it) => !nextIds.has(it.id));
              setItems([...next, ...untouched]);
            }}
            className="wlx-grid"
            as="div"
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((it) => (
                <WLCard key={it.id} item={it} onRemove={removeItem} />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        )}
      </div>
    </div>
  );
}

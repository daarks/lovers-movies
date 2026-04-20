import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Filter, Search, Star, X, Tv, Film, Clock } from "lucide-react";
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
  TiltCard,
  cx,
} from "../ds";
import { apiGet } from "../lib/api";
import { GENRE_CHIPS, genresMatchFilter } from "../lib/genreMatch";
import { mediaTypeLabel } from "../lib/utils";
import type { HistoryItem, HistoryResponse } from "../lib/types";

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

function HistoryCard({ item, index }: { item: HistoryItem; index: number }) {
  const reduce = useReducedMotion();
  const ratingOutOf10 = item.rating ?? 0;
  return (
    <motion.a
      href={`/details/${item.media_type}/${item.tmdb_id}`}
      className="hix-card rx-cv-card"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.25), type: "spring", stiffness: 160, damping: 22 }}
    >
      <TiltCard className="hix-card-poster">
        <MediaPoster path={item.poster_path} size="w342" title={item.title} />
        <span className="hix-card-badge">
          {item.media_type === "tv" ? <Tv size={12} /> : <Film size={12} />}
          {mediaTypeLabel(item.media_type)}
        </span>
      </TiltCard>
      <div className="hix-card-body">
        <strong className="hix-card-title">{item.title}</strong>
        <div className="hix-card-meta">
          <Star size={13} fill="currentColor" aria-hidden="true" />
          <span className="hix-card-rating">
            {ratingOutOf10 ? ratingOutOf10.toFixed(1).replace(".", ",") : "—"}
          </span>
          {item.release_date && item.release_date.length >= 4 && (
            <span className="hix-card-year">{item.release_date.slice(0, 4)}</span>
          )}
        </div>
      </div>
    </motion.a>
  );
}

function HistoryCardSkeleton() {
  return (
    <div className="hix-card hix-card--skel">
      <Skeleton className="hix-card-poster" style={{ aspectRatio: "2 / 3" }} />
      <Skeleton style={{ width: "80%", height: 16, marginTop: 10 }} />
      <Skeleton style={{ width: "50%", height: 13, marginTop: 6 }} />
    </div>
  );
}

export default function HistoryApp() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 220);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [genre, setGenre] = useState<string>("");
  const [exactRating, setExactRating] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<HistoryResponse>("/api/history")
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Não foi possível carregar o histórico.");
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
      if (exactRating !== null) {
        if (it.rating === null || it.rating === undefined) return false;
        if (Math.abs(it.rating - exactRating) > 0.051) return false;
      }
      if (q) {
        const hay = (it.title + " " + (it.original_title || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }, [items, debounced, media, genre, exactRating]);

  const totalItems = items?.length ?? 0;
  const filteredCount = filtered.length;
  const avgRating = useMemo(() => {
    if (!items || !items.length) return 0;
    const vals = items.map((i) => i.rating ?? 0).filter((v) => v > 0);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [items]);

  const filtersActive = media !== "all" || genre !== "" || exactRating !== null || query.trim() !== "";

  return (
    <div ref={rootRef} className="hix-root">
      <ScrollReveal>
        <section className="hix-hero">
          <div className="hix-hero-aura" aria-hidden="true" />
          <div className="hix-hero-inner">
            <span className="hix-hero-eyebrow">
              <Clock size={14} /> Histórico do casal
            </span>
            <h1 className="hix-hero-title">
              <GradientTitle as="span" size="xl">
                Tudo que já assistimos juntos
              </GradientTitle>
            </h1>
            <p className="hix-hero-sub">
              Cada título que entrou no nosso ritual de filme do casal. Filtre, busque, e revisite memórias.
            </p>
            <div className="hix-hero-stats">
              <div className="hix-hero-stat">
                <span className="hix-hero-stat-value">
                  <NumberTicker value={totalItems} />
                </span>
                <span className="hix-hero-stat-label">Títulos no total</span>
              </div>
              <div className="hix-hero-stat">
                <span className="hix-hero-stat-value">
                  {avgRating > 0 ? avgRating.toFixed(1).replace(".", ",") : "—"}
                </span>
                <span className="hix-hero-stat-label">Nota média</span>
              </div>
              <div className="hix-hero-stat">
                <span className="hix-hero-stat-value">
                  <NumberTicker value={filteredCount} />
                </span>
                <span className="hix-hero-stat-label">Exibindo agora</span>
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
            placeholder="Buscar no histórico..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar no histórico"
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

      <Sheet open={filterOpen} onOpenChange={setFilterOpen} title="Filtrar histórico">
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
          <section>
            <h3 className="hix-sheet-label">Nota exata</h3>
            <div className="hix-star-grid">
              <Chip
                variant={exactRating === null ? "accent" : "soft"}
                active={exactRating === null}
                onClick={() => setExactRating(null)}
              >
                Qualquer
              </Chip>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <Chip
                  key={n}
                  variant={exactRating === n ? "gold" : "soft"}
                  active={exactRating === n}
                  onClick={() => setExactRating(n)}
                  icon={<Star size={12} fill="currentColor" />}
                >
                  {n}
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
                setExactRating(null);
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

      <div className="hix-grid-wrap">
        {error && <p className="hix-error">{error}</p>}
        {!items && !error && (
          <div className="hix-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <HistoryCardSkeleton key={i} />
            ))}
          </div>
        )}
        {items && !error && filtered.length === 0 && (
          <div className="hix-empty">
            {totalItems === 0 ? (
              <>
                <p>Nenhum filme ou série no histórico ainda.</p>
                <MagneticButton as="a" href="/" variant="primary">
                  Ir para Assistir
                </MagneticButton>
              </>
            ) : (
              <>
                <p>Nenhum resultado para esses filtros.</p>
                <button
                  type="button"
                  className="hix-btn-ghost"
                  onClick={() => {
                    setGenre("");
                    setExactRating(null);
                    setMedia("all");
                    setQuery("");
                  }}
                >
                  Limpar filtros
                </button>
              </>
            )}
          </div>
        )}
        {items && filtered.length > 0 && (
          <motion.div className="hix-grid" layout>
            <AnimatePresence mode="popLayout">
              {filtered.map((it, idx) => (
                <HistoryCard key={it.id} item={it} index={idx} />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}

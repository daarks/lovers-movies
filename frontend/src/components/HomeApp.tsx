import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search, Sparkles, Film, Tv, Flame, CalendarDays, Star } from "lucide-react";
import {
  GradientTitle,
  MagneticButton,
  MediaPoster,
  ScrollReveal,
  ShinyText,
  Skeleton,
  SpotlightCard,
  SurfacePanel,
  TiltCard,
  TypewriterTitle,
  cx,
} from "../ds";
import { apiGet } from "../lib/api";
import type { HomeFeed, HomeMediaItem, HomeRecentItem, SearchHit } from "../lib/types";
import { formatDateBR, posterUrl } from "../lib/utils";

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function SearchHitsDropdown({
  query,
  onPick,
}: {
  query: string;
  onPick(hit: SearchHit): void;
}) {
  const [items, setItems] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounced(query, 220);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setItems(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    apiGet<{ results: SearchHit[] }>("/search", {
      params: { q, format: "json" },
      signal: ctrl.signal,
    })
      .then((r) => setItems(r.results || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debounced]);

  if (debounced.trim().length < 2) return null;
  return (
    <div className="home-search-dropdown" role="listbox">
      {loading ? (
        <div className="home-search-row home-search-row--loading">
          <Skeleton width={48} height={72} rounded="sm" />
          <div className="rx-stack rx-stack--tight" style={{ flex: 1 }}>
            <Skeleton width="70%" height={14} />
            <Skeleton width="40%" height={10} />
          </div>
        </div>
      ) : items && items.length === 0 ? (
        <p className="home-search-empty">Nenhum filme ou série encontrado.</p>
      ) : (
        (items ?? []).slice(0, 8).map((hit) => (
          <button
            key={`${hit.media_type}-${hit.id}`}
            type="button"
            className="home-search-row"
            role="option"
            onClick={() => onPick(hit)}
          >
            <img
              src={hit.poster_path ? posterUrl(hit.poster_path, "w92") : "/static/favicon.svg"}
              alt=""
              loading="lazy"
              className="home-search-poster"
            />
            <div className="home-search-meta">
              <span className="home-search-title">{hit.title}</span>
              <span className="home-search-sub">
                {hit.media_type === "tv" ? (
                  <>
                    <Tv size={13} aria-hidden="true" /> Série
                  </>
                ) : (
                  <>
                    <Film size={13} aria-hidden="true" /> Filme
                  </>
                )}
                {hit.release_date ? <span> · {hit.release_date.slice(0, 4)}</span> : null}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function MediaCard({ item }: { item: HomeMediaItem | HomeRecentItem }) {
  const mt = item.media_type;
  const tmdbId = "tmdb_id" in item ? item.tmdb_id : item.id;
  const rating = "rating" in item && item.rating != null ? item.rating : null;
  const year = "release_date" in item && item.release_date ? item.release_date.slice(0, 4) : null;
  const href = `/details/${mt}/${tmdbId}`;
  return (
    <a href={href} className="home-card">
      <TiltCard className="home-card-poster" glare={false} maxTilt={7} scale={1.03}>
        <MediaPoster path={item.poster_path ?? undefined} title={item.title} size="w342" />
        <span className="home-card-kind" aria-hidden="true">
          {mt === "tv" ? <Tv size={12} /> : <Film size={12} />}
          {mt === "tv" ? "Série" : "Filme"}
        </span>
        {rating != null ? (
          <span className="home-card-rating" aria-label={`Nota ${rating}`}>
            <Star size={12} aria-hidden="true" /> {rating.toFixed(1)}
          </span>
        ) : null}
      </TiltCard>
      <span className="home-card-title">{item.title}</span>
      {year ? <span className="home-card-meta">{year}</span> : null}
    </a>
  );
}

function Carousel({ title, icon, items }: { title: string; icon: React.ReactNode; items: HomeMediaItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="home-section" aria-labelledby={`hs-${title}`}>
      <header className="home-section-head">
        <h2 id={`hs-${title}`} className="home-section-title">
          <span className="home-section-icon" aria-hidden="true">{icon}</span>
          {title}
        </h2>
      </header>
      <div className="rx-scroll-x home-carousel">
        {items.map((it, idx) => (
          <ScrollReveal key={`${it.media_type}-${it.id}-${idx}`} delay={Math.min(idx * 0.04, 0.2)}>
            <MediaCard item={it} />
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}

function BentoCinema({ items, upcoming }: { items: HomeMediaItem[]; upcoming: HomeMediaItem[] }) {
  const feature = items[0];
  const secondary = items.slice(1, 4);
  const next = upcoming.slice(0, 3);
  if (!feature && next.length === 0) return null;
  return (
    <section className="home-section" aria-labelledby="hs-cinema">
      <header className="home-section-head">
        <h2 id="hs-cinema" className="home-section-title">
          <span className="home-section-icon" aria-hidden="true"><Film size={18} /></span>
          Cinema e estreias
        </h2>
      </header>
      <div className="home-bento">
        {feature ? (
          <SpotlightCard className="home-bento-feature" onClick={() => (window.location.href = `/details/movie/${feature.id}`)}>
            <div className="home-bento-feature-poster">
              <MediaPoster path={feature.poster_path ?? undefined} title={feature.title} size="w500" />
            </div>
            <div className="home-bento-feature-body">
              <p className="rx-eyebrow">Em cartaz · BR</p>
              <h3 className="home-bento-feature-title">{feature.title}</h3>
              {feature.release_date ? (
                <p className="home-bento-feature-meta">
                  <CalendarDays size={14} aria-hidden="true" /> {formatDateBR(feature.release_date)}
                </p>
              ) : null}
            </div>
          </SpotlightCard>
        ) : null}
        <div className="home-bento-grid">
          {secondary.map((it) => (
            <a key={`feat-${it.id}`} href={`/details/movie/${it.id}`} className="home-bento-tile">
              <div className="home-bento-tile-poster">
                <MediaPoster path={it.poster_path ?? undefined} title={it.title} size="w342" />
              </div>
              <span className="home-bento-tile-title">{it.title}</span>
            </a>
          ))}
        </div>
        {next.length > 0 ? (
          <SurfacePanel variant="shell" className="home-bento-upcoming" aura>
            <p className="rx-eyebrow">Em breve</p>
            <ul className="home-bento-upcoming-list">
              {next.map((it) => (
                <li key={`up-${it.id}`}>
                  <a href={`/details/movie/${it.id}`} className="home-bento-upcoming-item">
                    <span className="home-bento-upcoming-title">{it.title}</span>
                    {it.release_date ? <span className="home-bento-upcoming-date">{formatDateBR(it.release_date)}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          </SurfacePanel>
        ) : null}
      </div>
    </section>
  );
}

export default function HomeApp() {
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const ctrl = new AbortController();
    apiGet<HomeFeed>("/api/home/feed", { signal: ctrl.signal, timeoutMs: 28_000 })
      .then(setFeed)
      .catch((e) => setError(e?.message ?? "Falha ao carregar destaques."));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (feed || error) {
      document.getElementById("home-root")?.removeAttribute("aria-busy");
    }
  }, [feed, error]);

  const heroText = useMemo(
    () => feed?.hero_message ?? "O que vamos ver hoje baby?",
    [feed?.hero_message]
  );

  function onPick(hit: SearchHit) {
    window.location.href = `/details/${hit.media_type}/${hit.id}`;
  }

  const trending = feed?.trending ?? [];
  const nowPlaying = feed?.now_playing ?? [];
  const upcoming = feed?.upcoming ?? [];
  const recent = feed?.recent ?? [];

  return (
    <div className="rx-root home-root">
      <section className="home-hero">
        <span className="home-hero-aura" aria-hidden="true" />
        <span className="home-hero-stars" aria-hidden="true" />
        <motion.div
          className="home-hero-inner"
          initial={reduced ? undefined : { opacity: 0, y: 18 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <p className="rx-eyebrow home-hero-eyebrow">Cinema do casal</p>
          <GradientTitle as="h1" size="display" className="home-hero-title">
            <TypewriterTitle text={heroText} speed={55} />
          </GradientTitle>
          <p className="home-hero-tagline">
            Buscas, descobertas e listas — tudo num toque.
            <ShinyText className="home-hero-tagline-shine"> Sugestões inteligentes</ShinyText> para os dois.
          </p>

          <div className="home-search">
            <Search size={18} aria-hidden="true" className="home-search-icon" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar filme ou série…"
              className="home-search-input"
              aria-label="Buscar filme ou série no TMDB"
              autoComplete="off"
            />
            {q ? (
              <button
                type="button"
                className="home-search-clear"
                onClick={() => {
                  setQ("");
                  inputRef.current?.focus();
                }}
                aria-label="Limpar busca"
              >
                ×
              </button>
            ) : null}
            <AnimatePresence>
              {q.trim().length >= 2 ? (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="home-search-dropdown-wrap"
                >
                  <SearchHitsDropdown query={q} onPick={onPick} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="home-hero-actions">
            <MagneticButton href="/suggestions" variant="primary" size="lg" shine>
              <Sparkles size={18} aria-hidden="true" /> Sugestões inteligentes
            </MagneticButton>
            <MagneticButton href="/historico" variant="glass" size="lg" shine={false}>
              Histórico do casal
            </MagneticButton>
          </div>
        </motion.div>
      </section>

      <div className="home-body">
        {error ? (
          <SurfacePanel variant="shell" className="home-error">
            <p>Não foi possível carregar os destaques agora: {error}</p>
          </SurfacePanel>
        ) : null}

        <Carousel title="Destaques da semana" icon={<Flame size={18} />} items={trending} />

        <BentoCinema items={nowPlaying} upcoming={upcoming} />

        {recent.length > 0 ? (
          <section className="home-section" aria-labelledby="hs-recent">
            <header className="home-section-head">
              <h2 id="hs-recent" className="home-section-title">
                <span className="home-section-icon" aria-hidden="true"><CalendarDays size={18} /></span>
                Últimos que vocês viram
              </h2>
            </header>
            <div className={cx("rx-scroll-x home-carousel")}>
              {recent.map((it, idx) => (
                <ScrollReveal key={`r-${it.id}`} delay={Math.min(idx * 0.03, 0.18)}>
                  <MediaCard item={it} />
                </ScrollReveal>
              ))}
            </div>
          </section>
        ) : null}

        {!feed && !error ? (
          <section className="home-section">
            <div className="home-carousel home-skeleton-row">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="home-card home-card--skeleton">
                  <Skeleton height={200} rounded="md" />
                  <Skeleton width="80%" height={12} />
                  <Skeleton width="50%" height={10} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

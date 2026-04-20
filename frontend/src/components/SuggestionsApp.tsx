import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion, useReducedMotion } from "framer-motion";
import {
  Shuffle,
  Sparkles,
  Tag,
  Wand2,
  Tv,
  Film,
  Dices,
  X,
  Plus,
  Minus,
  Star,
  ArrowRight,
} from "lucide-react";
import {
  Chip,
  GradientTitle,
  MagneticButton,
  MediaPoster,
  ScrollReveal,
  SegmentedToggle,
  ShinyText,
  Skeleton,
  SpotlightCard,
  SurfacePanel,
  TiltCard,
  cx,
} from "../ds";
import { apiGet } from "../lib/api";
import { formatDateBR, mediaTypeLabel, posterUrl } from "../lib/utils";
import type { SearchHit } from "../lib/types";

/* ---------------- Tipos ---------------- */

interface SuggestionResult {
  id: number;
  title: string;
  media_type: "movie" | "tv";
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  overview?: string | null;
  vote_average?: number | null;
  genres?: string[];
  original_title?: string | null;
  runtime?: number | null;
  matched_keywords?: Array<{ id: number; name: string }>;
  matched_mode?: "all" | "any" | string;
}

interface GeminiCardResult extends SuggestionResult {
  tmdb_id?: number;
  reason?: string | null;
  pitch?: string | null;
  liked_titles?: string[];
  gemini_notes?: string | null;
  saved?: boolean;
}

interface GeminiResponse {
  results: GeminiCardResult[];
  error?: string;
  detail?: string | Record<string, unknown>;
}

type MediaChoice = "movie" | "tv";
type GeminiScope = "mixed" | "movie" | "tv";

interface GenreChip {
  genreId?: string;
  keywordId?: string;
  label: string;
  theme: string;
  emoji: string;
  icon?: React.ReactNode;
}

interface KeywordItem {
  id: number;
  name: string;
}

/* ---------------- Dados estáticos ---------------- */

const GENRE_CHIPS: GenreChip[] = [
  { genreId: "27", label: "Terror", theme: "terror", emoji: "👻" },
  { genreId: "18", label: "Drama", theme: "drama", emoji: "🎭" },
  { genreId: "53", label: "Suspense", theme: "suspense", emoji: "🕵️" },
  { genreId: "28", label: "Ação", theme: "acao", emoji: "💥" },
  { genreId: "12", label: "Aventura", theme: "aventura", emoji: "🗺️" },
  { genreId: "16", label: "Animação", theme: "animacao", emoji: "🎨" },
  { keywordId: "210024", label: "Anime", theme: "animacao", emoji: "🍥" },
  { genreId: "878", label: "Ficção Científica", theme: "ficcao", emoji: "🚀" },
  { genreId: "10766", label: "Novela", theme: "novela", emoji: "💌" },
  { genreId: "80", label: "Policial", theme: "policial", emoji: "🔫" },
  { genreId: "35", label: "Comédia", theme: "comedia", emoji: "😂" },
  { genreId: "10749", label: "Romance", theme: "romance", emoji: "💘" },
  { genreId: "", label: "Qualquer gênero", theme: "default", emoji: "🎲" },
];

const GEMINI_SCOPE_OPTIONS = [
  { value: "mixed" as const, label: "Misto", icon: <Sparkles size={14} /> },
  { value: "movie" as const, label: "Filmes", icon: <Film size={14} /> },
  { value: "tv" as const, label: "Séries", icon: <Tv size={14} /> },
];

const MEDIA_OPTIONS = [
  { value: "movie" as const, label: "Filmes", icon: <Film size={14} /> },
  { value: "tv" as const, label: "Séries", icon: <Tv size={14} /> },
];

/* ---------------- Hooks utilitários ---------------- */

function useDebounced<T>(value: T, ms = 260): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function useClickOutside<T extends HTMLElement>(ref: React.RefObject<T>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function handle(ev: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(ev.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onClose, active]);
}

/* ---------------- Card de resultado ---------------- */

function ResultCard({ data, onAgain, againLabel = "Sortear outro" }: {
  data: SuggestionResult;
  onAgain?: () => void;
  againLabel?: string;
}) {
  const backdrop = data.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
    : null;
  const reduceMotion = useReducedMotion();
  const year =
    data.release_date && data.release_date.length >= 4
      ? data.release_date.slice(0, 4)
      : "";
  return (
    <motion.div
      className="sgx-result-card"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
    >
      {backdrop && (
        <div
          className="sgx-result-backdrop"
          style={{ backgroundImage: `url(${backdrop})` }}
          aria-hidden="true"
        />
      )}
      <div className="sgx-result-inner">
        <TiltCard className="sgx-result-poster">
          <MediaPoster path={data.poster_path} size="w342" title={data.title} />
        </TiltCard>
        <div className="sgx-result-body">
          <span className="sgx-result-chip">
            {data.media_type === "tv" ? <Tv size={12} /> : <Film size={12} />}
            {mediaTypeLabel(data.media_type)}
            {year ? ` · ${year}` : ""}
          </span>
          <h3 className="sgx-result-title">
            <GradientTitle as="span" size="lg">
              {data.title}
            </GradientTitle>
          </h3>
          {data.genres && data.genres.length > 0 && (
            <div className="sgx-result-genres">
              {data.genres.slice(0, 4).map((g) => (
                <Chip key={g} variant="soft" disabled>
                  {g}
                </Chip>
              ))}
            </div>
          )}
          {typeof data.vote_average === "number" && data.vote_average > 0 && (
            <div className="sgx-result-score">
              <Star size={14} fill="currentColor" />
              <span>{data.vote_average.toFixed(1)}</span>
              <span className="sgx-result-score-label">TMDB</span>
            </div>
          )}
          {data.overview && <p className="sgx-result-overview">{data.overview}</p>}
          {data.matched_keywords && data.matched_keywords.length > 0 && (
            <div className="sgx-result-kw">
              <span className="sgx-result-kw-label">
                {data.matched_mode === "any" ? "Encontrado com qualquer uma:" : "Combinou:"}
              </span>
              <div className="sgx-result-kw-chips">
                {data.matched_keywords.map((k) => (
                  <Chip key={k.id} variant="accent" disabled>
                    {k.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <div className="sgx-result-actions">
            <MagneticButton
              as="a"
              href={`/details/${data.media_type}/${data.id}`}
              variant="primary"
              className="sgx-result-cta"
            >
              Ver detalhes <ArrowRight size={16} />
            </MagneticButton>
            {onAgain && (
              <button type="button" className="sgx-btn-ghost" onClick={onAgain}>
                <Shuffle size={14} /> {againLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ResultSkeleton() {
  return (
    <div className="sgx-result-card sgx-result-skeleton">
      <div className="sgx-result-inner">
        <Skeleton className="sgx-result-poster" style={{ aspectRatio: "2 / 3" }} />
        <div className="sgx-result-body">
          <Skeleton style={{ width: "40%", height: 18 }} />
          <Skeleton style={{ width: "80%", height: 32, marginTop: 10 }} />
          <Skeleton style={{ width: "60%", height: 14, marginTop: 14 }} />
          <Skeleton style={{ width: "100%", height: 60, marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Seção 1: Aleatório por gênero ---------------- */

function RandomByGenreSection() {
  const [media, setMedia] = useState<MediaChoice>("movie");
  const [activeChip, setActiveChip] = useState<GenreChip>(GENRE_CHIPS[GENRE_CHIPS.length - 1]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.setAttribute("data-genre-theme", activeChip.theme || "default");
  }, [activeChip]);

  function pickChip(chip: GenreChip) {
    setActiveChip(chip);
    if (chip.genreId === "10766") setMedia("tv");
  }

  const currentMedia: MediaChoice = activeChip.genreId === "10766" ? "tv" : media;

  async function fetchRandom() {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { media_type: currentMedia };
      if (activeChip.keywordId) {
        const kid = parseInt(activeChip.keywordId, 10);
        if (!isNaN(kid)) body.keyword_id = kid;
      } else if (activeChip.genreId) {
        const gid = parseInt(activeChip.genreId, 10);
        if (!isNaN(gid)) body.genre_id = gid;
      }
      const res = await fetch("/suggestions/random", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SuggestionResult & { error?: string };
      if (!res.ok || !data.id) {
        setError(data.error || "Não foi possível obter sugestão.");
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError("Erro de rede. Tente novamente.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollReveal className="sgx-section" aria-labelledby="sgx-random-title">
      <SurfacePanel className="sgx-panel">
        <header className="sgx-section-head">
          <span className="sgx-section-eyebrow">
            <Dices size={14} /> Sorteio aleatório
          </span>
          <h2 id="sgx-random-title" className="sgx-section-title">
            <GradientTitle as="span">
              Surpreenda-nos hoje
            </GradientTitle>
          </h2>
          <p className="sgx-section-sub">
            Escolha um gênero, a gente sorteia um título do TMDB pra vocês assistirem juntinhos.
          </p>
        </header>

        <div className="sgx-section-controls">
          <SegmentedToggle
            value={currentMedia}
            onValueChange={(v) => setMedia(v)}
            options={MEDIA_OPTIONS}
            ariaLabel="Filmes ou séries"
          />
        </div>

        <div className="sgx-genre-grid" role="list">
          {GENRE_CHIPS.map((chip) => {
            const active = chip === activeChip;
            return (
              <button
                key={`${chip.genreId || ""}-${chip.keywordId || ""}-${chip.label}`}
                type="button"
                role="listitem"
                className={cx("sgx-genre-card", active && "is-active")}
                data-theme={chip.theme}
                onClick={() => pickChip(chip)}
                aria-pressed={active}
              >
                <SpotlightCard className="sgx-genre-spotlight">
                  <span className="sgx-genre-emoji" aria-hidden="true">
                    {chip.emoji}
                  </span>
                  <span className="sgx-genre-label">{chip.label}</span>
                </SpotlightCard>
              </button>
            );
          })}
        </div>

        <div className="sgx-section-cta">
          <MagneticButton
            onClick={fetchRandom}
            variant="primary"
            disabled={loading}
            className="sgx-primary-cta"
          >
            <Shuffle size={18} />
            <ShinyText>{loading ? "Sorteando..." : "Sugerir!"}</ShinyText>
          </MagneticButton>
        </div>

        <div className="sgx-result-wrap" aria-live="polite">
          <AnimatePresence mode="wait">
            {loading && <ResultSkeleton key="sgx-random-skel" />}
            {!loading && error && (
              <motion.p
                key="sgx-random-err"
                className="sgx-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.p>
            )}
            {!loading && !error && result && (
              <ResultCard key={`rnd-${result.id}`} data={result} onAgain={fetchRandom} />
            )}
          </AnimatePresence>
        </div>
      </SurfacePanel>
    </ScrollReveal>
  );
}

/* ---------------- Seção 2: Palavras-chave ---------------- */

function KeywordsSection() {
  const [media, setMedia] = useState<MediaChoice>("movie");
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 260);
  const [dropdown, setDropdown] = useState<KeywordItem[] | null>(null);
  const [loadingDropdown, setLoadingDropdown] = useState(false);
  const [selected, setSelected] = useState<KeywordItem[]>([]);
  const [presets, setPresets] = useState<KeywordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useClickOutside(wrapRef, () => setDropdown(null), dropdown !== null);

  useEffect(() => {
    let cancelled = false;
    fetch("/static/data/keyword_presets.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        if (!Array.isArray(list)) return;
        setPresets(
          list
            .map((kw: { id?: number; name?: string }) => ({
              id: Number(kw.id),
              name: String(kw.name || ""),
            }))
            .filter((kw) => Number.isFinite(kw.id) && kw.name)
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      setDropdown(null);
      return;
    }
    const ctrl = new AbortController();
    setLoadingDropdown(true);
    apiGet<{ results: KeywordItem[] }>("/search/keyword", {
      params: { q },
      signal: ctrl.signal,
    })
      .then((data) => {
        setDropdown((data.results || []).slice(0, 12));
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setDropdown([]);
      })
      .finally(() => setLoadingDropdown(false));
    return () => ctrl.abort();
  }, [debounced]);

  function addKeyword(kw: KeywordItem) {
    if (selected.length >= 10) return;
    if (selected.some((x) => x.id === kw.id)) return;
    setSelected((prev) => [...prev, kw]);
    setQuery("");
    setDropdown(null);
    inputRef.current?.focus();
  }

  function removeKeyword(id: number) {
    setSelected((prev) => prev.filter((x) => x.id !== id));
  }

  async function fetchKwSuggest() {
    if (!selected.length) {
      setError("Adicione ao menos uma palavra-chave.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/suggestions/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          keyword_ids: selected.map((k) => k.id),
          media_type: media,
        }),
      });
      const data = (await res.json()) as SuggestionResult & { error?: string };
      if (!res.ok || !data.id) {
        setError(data.error || "Não foi possível sortear.");
        setResult(null);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError("Erro de rede. Tente novamente.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollReveal className="sgx-section" aria-labelledby="sgx-kw-title">
      <SurfacePanel className="sgx-panel sgx-panel--alt">
        <header className="sgx-section-head">
          <span className="sgx-section-eyebrow">
            <Tag size={14} /> Palavras-chave
          </span>
          <h2 id="sgx-kw-title" className="sgx-section-title">
            <GradientTitle as="span" variant="rose">
              Crie o clima da noite
            </GradientTitle>
          </h2>
          <p className="sgx-section-sub">
            Até 10 palavras-chave. Tentamos primeiro com <strong>todas</strong>; se não rolar, fazemos com <strong>qualquer uma</strong>.
          </p>
        </header>

        <div className="sgx-section-controls">
          <SegmentedToggle
            value={media}
            onValueChange={(v) => setMedia(v)}
            options={MEDIA_OPTIONS}
            ariaLabel="Filmes ou séries (palavras-chave)"
          />
        </div>

        {presets.length > 0 && (
          <>
            <p className="sgx-kw-presets-hint">Sugestões rápidas (curadas):</p>
            <div className="sgx-kw-presets" role="list">
              {presets.map((kw) => {
                const active = selected.some((x) => x.id === kw.id);
                return (
                  <button
                    key={kw.id}
                    type="button"
                    role="listitem"
                    className={cx("sgx-kw-preset", active && "is-active")}
                    onClick={() => (active ? removeKeyword(kw.id) : addKeyword(kw))}
                  >
                    {active ? <Minus size={12} /> : <Plus size={12} />}
                    {kw.name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="sgx-kw-search-wrap" ref={wrapRef}>
          <input
            ref={inputRef}
            type="search"
            className="sgx-search-input"
            placeholder="Buscar palavra-chave no TMDB..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (query.trim().length >= 2) setDropdown(dropdown || []);
            }}
            aria-label="Buscar palavra-chave"
          />
          <AnimatePresence>
            {dropdown !== null && (
              <motion.div
                className="sgx-search-dropdown"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                role="listbox"
              >
                {loadingDropdown && (
                  <>
                    <Skeleton style={{ height: 34, margin: 6 }} />
                    <Skeleton style={{ height: 34, margin: 6 }} />
                    <Skeleton style={{ height: 34, margin: 6 }} />
                  </>
                )}
                {!loadingDropdown && dropdown.length === 0 && (
                  <div className="sgx-search-dd-empty">Nenhuma palavra-chave.</div>
                )}
                {!loadingDropdown &&
                  dropdown.map((kw) => (
                    <button
                      key={kw.id}
                      type="button"
                      className="sgx-search-dd-item"
                      onClick={() => addKeyword(kw)}
                    >
                      {kw.name}
                    </button>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {selected.length > 0 && (
          <Reorder.Group
            as="ul"
            axis="x"
            values={selected}
            onReorder={setSelected}
            className="sgx-kw-selected"
          >
            {selected.map((kw) => (
              <Reorder.Item
                key={kw.id}
                value={kw}
                as="li"
                className="sgx-kw-chip"
                whileDrag={{ scale: 1.05, cursor: "grabbing" }}
              >
                <span>{kw.name}</span>
                <button
                  type="button"
                  className="sgx-kw-chip-remove"
                  aria-label={`Remover ${kw.name}`}
                  onClick={() => removeKeyword(kw.id)}
                >
                  <X size={12} />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}

        <div className="sgx-section-cta">
          <MagneticButton
            onClick={fetchKwSuggest}
            variant="primary"
            disabled={loading || !selected.length}
            className="sgx-primary-cta"
          >
            <Shuffle size={18} />
            <ShinyText>{loading ? "Sorteando..." : "Sortear"}</ShinyText>
          </MagneticButton>
        </div>

        <div className="sgx-result-wrap" aria-live="polite">
          <AnimatePresence mode="wait">
            {loading && <ResultSkeleton key="sgx-kw-skel" />}
            {!loading && error && (
              <motion.p
                key="sgx-kw-err"
                className="sgx-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.p>
            )}
            {!loading && !error && result && (
              <ResultCard
                key={`kw-${result.id}`}
                data={result}
                onAgain={fetchKwSuggest}
                againLabel="Sortear de novo"
              />
            )}
          </AnimatePresence>
        </div>
      </SurfacePanel>
    </ScrollReveal>
  );
}

/* ---------------- Seção 3: Gemini ---------------- */

interface GeminiRow {
  id: string;
  value: string;
  hits: SearchHit[] | null;
  loading: boolean;
  open: boolean;
}

function makeRow(): GeminiRow {
  return { id: Math.random().toString(36).slice(2), value: "", hits: null, loading: false, open: false };
}

function GeminiAutocompleteRow({
  row,
  scope,
  canRemove,
  onChange,
  onRemove,
}: {
  row: GeminiRow;
  scope: GeminiScope;
  canRemove: boolean;
  onChange: (patch: Partial<GeminiRow>) => void;
  onRemove: () => void;
}) {
  const debounced = useDebounced(row.value, 260);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => onChange({ open: false }), row.open);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length < 2) {
      onChange({ hits: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    onChange({ loading: true });
    const type = scope === "mixed" ? "multi" : scope;
    apiGet<{ results: SearchHit[] }>("/search", {
      params: { q, type, format: "json" },
      signal: ctrl.signal,
    })
      .then((data) => onChange({ hits: (data.results || []).slice(0, 8), loading: false, open: true }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") onChange({ hits: [], loading: false });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, scope]);

  return (
    <div className="sgx-gemini-row" ref={wrapRef}>
      <div className="sgx-gemini-input-wrap">
        <input
          type="text"
          className="sgx-search-input"
          placeholder="Ex.: Interestelar, Bacurau, The Bear"
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value, open: true })}
          onFocus={() => onChange({ open: true })}
          aria-label="Título que vocês gostaram"
        />
        <AnimatePresence>
          {row.open && row.hits !== null && (
            <motion.div
              className="sgx-search-dropdown sgx-search-dropdown--media"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              role="listbox"
            >
              {row.loading && (
                <>
                  <Skeleton style={{ height: 52, margin: 6 }} />
                  <Skeleton style={{ height: 52, margin: 6 }} />
                </>
              )}
              {!row.loading && row.hits.length === 0 && (
                <div className="sgx-search-dd-empty">Nenhum resultado</div>
              )}
              {!row.loading &&
                row.hits.map((hit) => {
                  const poster = posterUrl(hit.poster_path, "w92");
                  const year =
                    hit.release_date && hit.release_date.length >= 4
                      ? hit.release_date.slice(0, 4)
                      : "";
                  return (
                    <button
                      key={`${hit.media_type}-${hit.id}`}
                      type="button"
                      className="sgx-search-dd-media"
                      onClick={() => onChange({ value: hit.title, open: false })}
                    >
                      {poster ? (
                        <img src={poster} alt="" width={38} height={56} loading="lazy" />
                      ) : (
                        <span className="sgx-search-dd-thumb-ph" aria-hidden="true">🎬</span>
                      )}
                      <span className="sgx-search-dd-media-body">
                        <strong>{hit.title}</strong>
                        <span className="sgx-search-dd-media-meta">
                          {year && <>{year} · </>}
                          <Chip variant="soft" disabled>
                            {mediaTypeLabel(hit.media_type)}
                          </Chip>
                        </span>
                      </span>
                    </button>
                  );
                })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {canRemove && (
        <button
          type="button"
          className="sgx-gemini-remove"
          onClick={onRemove}
          aria-label="Remover campo"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function GeminiSection() {
  const [scope, setScope] = useState<GeminiScope>("mixed");
  const [rows, setRows] = useState<GeminiRow[]>([makeRow()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeminiCardResult[] | null>(null);

  const patchRow = useCallback((id: string, patch: Partial<GeminiRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  async function fetchGemini() {
    const titles = rows.map((r) => r.value.trim()).filter(Boolean);
    if (!titles.length) {
      setError("Preencha pelo menos um título.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/suggestions/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ titles, media_scope: scope }),
      });
      const data = (await res.json()) as GeminiResponse;
      if (!res.ok) {
        const detail =
          data.detail && typeof data.detail === "string"
            ? `\n\n${data.detail}`
            : data.detail
            ? `\n\n${JSON.stringify(data.detail)}`
            : "";
        setError((data.error || "Não foi possível gerar sugestões agora.") + detail);
      } else if (!data.results?.length) {
        setError("Nenhum título encontrado no TMDB.");
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError("Não foi possível gerar sugestões agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollReveal className="sgx-section" aria-labelledby="sgx-gemini-title">
      <SurfacePanel className="sgx-panel sgx-panel--gemini">
        <div className="sgx-gemini-glow" aria-hidden="true" />
        <header className="sgx-section-head">
          <span className="sgx-section-eyebrow">
            <Wand2 size={14} /> IA Gemini
          </span>
          <h2 id="sgx-gemini-title" className="sgx-section-title">
            <GradientTitle as="span" variant="gold">
              Baseado no gosto de vocês
            </GradientTitle>
          </h2>
          <p className="sgx-section-sub">
            Conte até 5 filmes ou séries que amaram. A gente pede pro Gemini entender o perfil e monta uma lista sob medida.
          </p>
        </header>

        <div className="sgx-section-controls">
          <SegmentedToggle
            value={scope}
            onValueChange={(v) => setScope(v)}
            options={GEMINI_SCOPE_OPTIONS}
            ariaLabel="Escopo da sugestão Gemini"
          />
        </div>

        <div className="sgx-gemini-rows">
          {rows.map((row) => (
            <GeminiAutocompleteRow
              key={row.id}
              row={row}
              scope={scope}
              canRemove={rows.length > 1}
              onChange={(patch) => patchRow(row.id, patch)}
              onRemove={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
            />
          ))}
        </div>

        <div className="sgx-gemini-actions">
          <button
            type="button"
            className="sgx-btn-ghost"
            onClick={() => {
              if (rows.length >= 5) return;
              setRows((prev) => [...prev, makeRow()]);
            }}
            disabled={rows.length >= 5}
          >
            <Plus size={14} /> Adicionar título
          </button>
        </div>

        <div className="sgx-section-cta">
          <MagneticButton
            onClick={fetchGemini}
            variant="primary"
            disabled={loading}
            className="sgx-primary-cta"
          >
            <Sparkles size={18} />
            <ShinyText>{loading ? "Consultando Gemini..." : "Gerar sugestões"}</ShinyText>
          </MagneticButton>
        </div>

        <div className="sgx-gemini-results-wrap" aria-live="polite">
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="gemini-skel"
                className="sgx-gemini-slider"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {[0, 1, 2].map((i) => (
                  <div key={i} className="sgx-gemini-card sgx-gemini-card--skel">
                    <Skeleton style={{ aspectRatio: "2 / 3", width: "100%" }} />
                    <Skeleton style={{ height: 18, marginTop: 10, width: "80%" }} />
                    <Skeleton style={{ height: 48, marginTop: 10 }} />
                  </div>
                ))}
              </motion.div>
            )}
            {!loading && error && (
              <motion.p
                key="gemini-err"
                className="sgx-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ whiteSpace: "pre-line" }}
              >
                {error}
              </motion.p>
            )}
            {!loading && !error && results && (
              <motion.div
                key="gemini-results"
                className="sgx-gemini-slider"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 120, damping: 18 }}
              >
                {results.map((item, idx) => (
                  <motion.a
                    key={`${item.media_type}-${item.id}-${idx}`}
                    href={`/details/${item.media_type}/${item.id}`}
                    className="sgx-gemini-card"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, type: "spring", stiffness: 140, damping: 18 }}
                  >
                    <TiltCard className="sgx-gemini-poster">
                      <MediaPoster path={item.poster_path} size="w342" title={item.title} />
                    </TiltCard>
                    <div className="sgx-gemini-card-body">
                      <span className="sgx-gemini-badge">
                        {mediaTypeLabel(item.media_type)}
                      </span>
                      <strong className="sgx-gemini-card-title">{item.title}</strong>
                      {item.release_date && (
                        <span className="sgx-gemini-card-meta">{formatDateBR(item.release_date)}</span>
                      )}
                      {item.pitch && <p className="sgx-gemini-pitch">{item.pitch}</p>}
                      {!item.pitch && item.overview && (
                        <p className="sgx-gemini-pitch sgx-gemini-pitch--dim">{item.overview}</p>
                      )}
                    </div>
                  </motion.a>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SurfacePanel>
    </ScrollReveal>
  );
}

/* ---------------- Root ---------------- */

export default function SuggestionsApp() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.removeAttribute("aria-busy");
  }, []);

  return (
    <div ref={root} className="sgx-root">
      <section className="sgx-hero">
        <div className="sgx-hero-aura" aria-hidden="true" />
        <div className="sgx-hero-inner">
          <span className="sgx-hero-eyebrow">
            <Sparkles size={14} />
            Sugestões inteligentes
          </span>
          <h1 className="sgx-hero-title">
            <GradientTitle as="span" size="xl">
              O que vamos ver hoje, baby?
            </GradientTitle>
          </h1>
          <p className="sgx-hero-sub">
            Três jeitos diferentes de descobrir o próximo filme ou série do casal — sorteio premium, palavras-chave e IA.
          </p>
        </div>
      </section>

      <div className="sgx-sections">
        <RandomByGenreSection />
        <KeywordsSection />
        <GeminiSection />
      </div>
    </div>
  );
}

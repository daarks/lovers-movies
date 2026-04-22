import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, Reorder, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Clock,
  Film,
  Filter,
  GripVertical,
  Plus,
  Search,
  Trash2,
  Tv,
  X,
} from "lucide-react";
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
import { mediaTypeLabel, posterUrl } from "../lib/utils";
import type { SearchHit } from "../lib/types";
import type { WatchLaterItem, WatchLaterResponse } from "../lib/types";

type View = "grid" | "queue" | "create" | "detail";

type MediaFilter = "all" | "movie" | "tv";

const MEDIA_FILTERS = [
  { value: "all" as const, label: "Todos" },
  { value: "movie" as const, label: "Filmes", icon: <Film size={14} /> },
  { value: "tv" as const, label: "Séries", icon: <Tv size={14} /> },
];

interface MediaListsBuiltin {
  key: string;
  name: string;
  item_count: number;
  cover_poster_path?: string | null;
}

interface MediaListSummary {
  id: number;
  name: string;
  description: string;
  item_count: number;
  cover_poster_path?: string | null;
}

interface MediaListsSummaryPayload {
  builtin: MediaListsBuiltin;
  custom: MediaListSummary[];
}

interface ListDetailPayload {
  id: number;
  name: string;
  description: string;
  items: WatchLaterItem[];
}

function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function readView(): { view: View; listId: number | null } {
  const el = document.getElementById("listas-root");
  const raw = (el?.dataset.view || "grid").toLowerCase();
  const vid = (el?.dataset.listId || "").trim();
  const n = parseInt(vid, 10);
  if (raw === "queue") return { view: "queue", listId: null };
  if (raw === "create") return { view: "create", listId: null };
  if (raw === "detail" && Number.isFinite(n)) return { view: "detail", listId: n };
  return { view: "grid", listId: null };
}

function posterTMDB(path: string | null | undefined) {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/w342${path}`;
}

/* ---------- Grid ---------- */

function ListasGridView() {
  const [data, setData] = useState<MediaListsSummaryPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let c = false;
    apiGet<MediaListsSummaryPayload>("/api/media-lists")
      .then((j) => {
        if (!c) setData(j);
      })
      .catch((e: Error) => {
        if (!c) setErr(e.message || "Erro ao carregar listas.");
      });
    return () => {
      c = true;
    };
  }, []);

  const tiles = useMemo(() => {
    if (!data) return [];
    const out: { key: string; href: string; title: string; poster: string | null; count: number; isAdd: boolean }[] =
      [];
    out.push({
      key: "fila",
      href: appUrl("/listas/fila"),
      title: data.builtin.name,
      poster: data.builtin.cover_poster_path || null,
      count: data.builtin.item_count,
      isAdd: false,
    });
    for (const row of data.custom) {
      out.push({
        key: `c-${row.id}`,
        href: appUrl(`/listas/${row.id}`),
        title: row.name,
        poster: row.cover_poster_path || null,
        count: row.item_count,
        isAdd: false,
      });
    }
    out.push({ key: "add", href: appUrl("/listas/nova"), title: "Nova lista", poster: null, count: 0, isAdd: true });
    return out;
  }, [data]);

  return (
    <div className="lsx-root hix-root">
      <ScrollReveal>
        <section className="lsx-hero hix-hero">
          <div className="hix-hero-aura" aria-hidden="true" />
          <div className="hix-hero-inner">
            <span className="hix-hero-eyebrow">
              <Clock size={14} /> Coleções do casal
            </span>
            <h1 className="hix-hero-title">
              <GradientTitle as="span" size="xl" variant="rose">
                Listas
              </GradientTitle>
            </h1>
            <p className="hix-hero-sub">
              A fila <strong>Assistir depois</strong> e as listas que vocês criam — inclusive como deck no swipe e no
              sorteio aleatório.
            </p>
          </div>
        </section>
      </ScrollReveal>

      {err && <p className="hix-error">{err}</p>}
      {!data && !err && (
        <div className="lsx-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="lsx-tile lsx-tile--skel">
              <Skeleton className="lsx-tile-poster" style={{ aspectRatio: "2 / 3" }} />
              <Skeleton style={{ width: "70%", height: 14, marginTop: 10 }} />
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="lsx-grid">
          {tiles.map((t) =>
            t.isAdd ? (
              <a key={t.key} href={t.href} className="lsx-tile lsx-tile--add" aria-label="Criar nova lista">
                <span className="lsx-tile-add-inner" aria-hidden="true">
                  <Plus size={40} strokeWidth={1.5} />
                </span>
                <span className="lsx-tile-label">Nova lista</span>
              </a>
            ) : (
              <a key={t.key} href={t.href} className="lsx-tile">
                <div className="lsx-tile-poster">
                  {t.poster ? (
                    <img src={posterTMDB(t.poster)} alt="" className="lsx-tile-img" loading="lazy" />
                  ) : (
                    <div className="lsx-tile-ph" aria-hidden="true" />
                  )}
                  <span className="lsx-tile-badge">{t.count}</span>
                </div>
                <span className="lsx-tile-label">{t.title}</span>
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Create ---------- */

function ListasCreateView() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const n = name.trim();
    if (n.length < 1) {
      setErr("Informe um nome.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(appUrl("/api/media-lists"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: n, description: description.trim() || undefined }),
      });
      const j = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !j.id) {
        setErr(j.error || "Não foi possível criar.");
        return;
      }
      window.location.href = appUrl(`/listas/${j.id}`);
    } catch {
      setErr("Erro de rede.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lsx-root hix-root">
      <ScrollReveal>
        <section className="lsx-hero hix-hero">
          <div className="hix-hero-aura" aria-hidden="true" />
          <div className="hix-hero-inner">
            <span className="hix-hero-eyebrow">Nova coleção</span>
            <h1 className="hix-hero-title">
              <GradientTitle as="span" size="lg" variant="rose">
                Criar lista
              </GradientTitle>
            </h1>
            <p className="hix-hero-sub">Nome e descrição opcional. Depois você adiciona filmes e séries na próxima tela.</p>
          </div>
        </section>
      </ScrollReveal>

      <SurfacePanel className="lsx-form-panel" variant="plate" aura>
        <form onSubmit={submit} className="lsx-form">
          <label className="lsx-field">
            <span>Nome da lista</span>
            <input
              className="lsx-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              required
              autoFocus
            />
          </label>
          <label className="lsx-field">
            <span>Descrição (opcional)</span>
            <textarea className="lsx-textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          {err && <p className="hix-error">{err}</p>}
          <div className="lsx-form-actions">
            <MagneticButton type="button" variant="ghost" onClick={() => (window.location.href = appUrl("/listas"))}>
              <ArrowLeft size={16} /> Voltar
            </MagneticButton>
            <MagneticButton type="submit" variant="primary" disabled={saving}>
              {saving ? "Salvando…" : "Criar e continuar"}
            </MagneticButton>
          </div>
        </form>
      </SurfacePanel>
    </div>
  );
}

/* ---------- Detail (custom list) ---------- */

function ListDetailCard({ item, onRemove }: { item: WatchLaterItem; onRemove: (item: WatchLaterItem) => void }) {
  const year = item.release_date && item.release_date.length >= 4 ? item.release_date.slice(0, 4) : "";
  return (
    <article className="wlx-card rx-cv-card">
      <a href={`/details/${item.media_type}/${item.tmdb_id}`} className="wlx-card-poster-link" aria-label={`Abrir ${item.title}`}>
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
        <button type="button" className="wlx-card-remove" onClick={() => onRemove(item)} aria-label={`Remover ${item.title}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function ListasDetailView({ listId }: { listId: number }) {
  const [detail, setDetail] = useState<ListDetailPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qSearch, setQSearch] = useState("");
  const debSearch = useDebounced(qSearch, 260);
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const load = useCallback(() => {
    apiGet<ListDetailPayload>(`/api/media-lists/${listId}`)
      .then(setDetail)
      .catch((e: Error) => setErr(e.message || "Erro ao carregar lista."));
  }, [listId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!debSearch.trim()) {
      setHits(null);
      return;
    }
    let c = false;
    apiGet<{ results: SearchHit[] }>("/search", { params: { q: debSearch.trim(), type: "multi" } })
      .then((d) => {
        if (!c) setHits(d.results || []);
      })
      .catch(() => {
        if (!c) setHits([]);
      });
    return () => {
      c = true;
    };
  }, [debSearch]);

  async function addHit(h: SearchHit) {
    try {
      const res = await fetch(appUrl(`/api/media-lists/${listId}/items`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          tmdb_id: h.id,
          media_type: h.media_type,
          title: h.title,
          poster_path: h.poster_path,
          release_date: h.release_date,
          overview: h.overview || "",
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        alert(j.error || "Não foi possível adicionar.");
        return;
      }
      setQSearch("");
      setHits(null);
      load();
    } catch {
      alert("Erro de rede.");
    }
  }

  async function removeItem(it: WatchLaterItem) {
    if (!confirm(`Remover "${it.title}" desta lista?`)) return;
    try {
      const res = await fetch(appUrl(`/api/media-lists/${listId}/items/${it.id}`), { method: "DELETE" });
      if (res.ok) load();
      else alert("Não foi possível remover.");
    } catch {
      alert("Erro de rede.");
    }
  }

  async function deleteList() {
    if (!confirm("Excluir esta lista inteira?")) return;
    try {
      const res = await fetch(appUrl(`/api/media-lists/${listId}`), { method: "DELETE" });
      if (res.ok) window.location.href = appUrl("/listas");
      else alert("Não foi possível excluir.");
    } catch {
      alert("Erro de rede.");
    }
  }

  const items = detail?.items ?? [];

  return (
    <div className="lsx-root hix-root">
      <ScrollReveal>
        <section className="lsx-hero hix-hero">
          <div className="hix-hero-aura" aria-hidden="true" />
          <div className="hix-hero-inner">
            <button type="button" className="lsx-back-link" onClick={() => (window.location.href = appUrl("/listas"))}>
              <ArrowLeft size={16} /> Todas as listas
            </button>
            <h1 className="hix-hero-title">
              <GradientTitle as="span" size="lg" variant="rose">
                {detail?.name || "…"}
              </GradientTitle>
            </h1>
            {detail?.description ? <p className="hix-hero-sub">{detail.description}</p> : null}
            <div className="lsx-hero-actions">
              <MagneticButton variant="danger" size="sm" onClick={() => void deleteList()}>
                Excluir lista
              </MagneticButton>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {err && <p className="hix-error">{err}</p>}

      <SurfacePanel className="lsx-search-panel" variant="plate">
        <div className="lsx-dd-wrap">
          <div className="lsx-dd-input-wrap">
            <label htmlFor="lsx-list-tmdb-q" className="lsx-sr-only">
              Buscar no TMDB para adicionar à lista
            </label>
            <input
              id="lsx-list-tmdb-q"
              type="search"
              enterKeyHint="search"
              className="lsx-dd-input"
              placeholder="Ex.: Duna, The Bear…"
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
            />
            {qSearch ? (
              <button type="button" className="lsx-dd-clear" onClick={() => setQSearch("")} aria-label="Limpar busca">
                <X size={16} />
              </button>
            ) : null}
            <AnimatePresence>
              {hits && hits.length > 0 && (
                <motion.div
                  className="lsx-search-dropdown lsx-search-dropdown--media"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                  role="listbox"
                >
                  {hits.map((h) => {
                    const poster = posterUrl(h.poster_path, "w92");
                    const year =
                      h.release_date && h.release_date.length >= 4 ? h.release_date.slice(0, 4) : "";
                    return (
                      <button
                        key={`${h.media_type}-${h.id}`}
                        type="button"
                        className="lsx-search-dd-media"
                        onClick={() => void addHit(h)}
                        role="option"
                      >
                        {poster ? (
                          <img src={poster} alt="" width={38} height={56} loading="lazy" />
                        ) : (
                          <span className="lsx-search-dd-thumb-ph" aria-hidden="true">
                            🎬
                          </span>
                        )}
                        <span className="lsx-search-dd-media-body">
                          <strong>{h.title}</strong>
                          <span className="lsx-search-dd-media-meta">
                            {year ? <>{year} · </> : null}
                            <Chip variant="soft" disabled>
                              {mediaTypeLabel(h.media_type)}
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
        </div>
      </SurfacePanel>

      {!detail && !err ? (
        <div className="wlx-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="wlx-card wlx-card--skel">
              <Skeleton className="wlx-card-poster" style={{ aspectRatio: "2 / 3" }} />
            </div>
          ))}
        </div>
      ) : null}

      {detail && items.length === 0 ? (
        <p className="hix-empty">Lista vazia. Use a busca acima para adicionar títulos.</p>
      ) : null}

      {detail && items.length > 0 ? (
        <div className="wlx-grid">
          {items.map((it) => (
            <ListDetailCard key={it.id} item={it} onRemove={removeItem} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Queue (Assistir depois) — mesmo comportamento da antiga página ---------- */

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
      <a href={`/details/${item.media_type}/${item.tmdb_id}`} className="wlx-card-poster-link" aria-label={`Abrir detalhes de ${item.title}`}>
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
        <span className="wlx-card-handle" aria-label="Arraste para reordenar">
          <GripVertical size={14} />
        </span>
        <button type="button" className="wlx-card-remove" onClick={() => onRemove(item)} aria-label={`Remover ${item.title} da fila`}>
          <Trash2 size={14} />
        </button>
      </div>
    </Reorder.Item>
  );
}

function WLSkeleton() {
  return (
    <div className="wlx-card wlx-card--skel">
      <Skeleton className="wlx-card-poster" style={{ aspectRatio: "2 / 3" }} />
    </div>
  );
}

function ListasQueueView() {
  const [items, setItems] = useState<WatchLaterItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 220);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [genre, setGenre] = useState<string>("");
  const [filterOpen, setFilterOpen] = useState(false);

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
    } catch {
      alert("Erro de rede.");
    }
  }

  const totalItems = items?.length ?? 0;
  const filteredCount = filtered.length;
  const filtersActive = media !== "all" || genre !== "" || query.trim() !== "";

  return (
    <div className="wlx-root hix-root">
      <ScrollReveal>
        <section className="wlx-hero hix-hero">
          <div className="wlx-hero-aura hix-hero-aura" aria-hidden="true" />
          <div className="hix-hero-inner">
            <button type="button" className="lsx-back-link" onClick={() => (window.location.href = appUrl("/listas"))}>
              <ArrowLeft size={16} /> Todas as listas
            </button>
            <span className="hix-hero-eyebrow">
              <Clock size={14} /> Fila fixa
            </span>
            <h1 className="hix-hero-title">
              <GradientTitle as="span" size="xl" variant="rose">
                Assistir depois
              </GradientTitle>
            </h1>
            <p className="hix-hero-sub">
              Os títulos guardados na página de cada filme ou série. Arraste para priorizar.
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
            <button type="button" className="hix-search-clear" onClick={() => setQuery("")} aria-label="Limpar busca">
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

/* ---------- Root ---------- */

export default function ListasApp() {
  const { view, listId } = readView();

  useEffect(() => {
    document.getElementById("listas-root")?.removeAttribute("aria-busy");
  }, []);

  if (view === "create") return <ListasCreateView />;
  if (view === "queue") return <ListasQueueView />;
  if (view === "detail" && listId !== null) return <ListasDetailView listId={listId} />;
  return <ListasGridView />;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui-components/react/popover";
import { Dialog } from "@base-ui-components/react/dialog";
import { motion, useReducedMotion } from "framer-motion";
import { Search, X, ArrowLeftRight, Trash2, Sparkles } from "lucide-react";
import { apiGet } from "../lib/api";
import type {
  CompareCommonMember,
  CompareResponse,
  ComparePick,
  SearchHit,
} from "../lib/types";
import { classNames, mediaTypeLabel, posterUrl } from "../lib/utils";
import { GradientTitle, ScrollReveal } from "../ds";

interface Props {
  initialA?: { id: number; mt: "movie" | "tv" } | null;
  initialB?: { id: number; mt: "movie" | "tv" } | null;
}

type Slot = "left" | "right";

function emptyPick(id: number, mt: "movie" | "tv"): ComparePick {
  return { tmdb_id: id, media_type: mt };
}

function PosterOrPlaceholder({ path, alt }: { path?: string | null; alt?: string }) {
  if (!path) {
    return (
      <div className="cmp-poster cmp-poster--placeholder" aria-hidden="true">
        <span>🎬</span>
      </div>
    );
  }
  return (
    <img
      src={posterUrl(path, "w185")}
      alt={alt || ""}
      className="cmp-poster"
      width={120}
      height={180}
      loading="lazy"
    />
  );
}

function PickCard({
  slot,
  pick,
  onClear,
  slotLabel,
  emptyHint,
}: {
  slot: Slot;
  pick: ComparePick | null;
  onClear: () => void;
  slotLabel: string;
  emptyHint: string;
}) {
  const empty = !pick || !pick.tmdb_id;
  return (
    <article
      className={classNames(
        "cmp-col rx-panel rx-panel--glow",
        empty && "cmp-col--empty",
        `cmp-col--${slot}`
      )}
      aria-live="polite"
    >
      <header className="cmp-col-head">
        <span className="rx-chip rx-chip--soft">{slotLabel}</span>
        {!empty && (
          <button
            type="button"
            className="rx-btn rx-btn--ghost rx-btn--sm"
            onClick={onClear}
            aria-label="Limpar este slot"
          >
            <Trash2 size={14} />
            Limpar
          </button>
        )}
      </header>
      {empty ? (
        <div className="cmp-col-empty">
          <Search size={22} aria-hidden="true" />
          <p>{emptyHint}</p>
        </div>
      ) : (
        <div className="cmp-col-body">
          <PosterOrPlaceholder path={pick?.poster_path} alt={pick?.title} />
          <div className="cmp-col-text">
            <span className="rx-chip rx-chip--soft">
              {mediaTypeLabel(pick?.media_type || "movie")}
            </span>
            <h3 className="cmp-col-title">{pick?.title || "Carregando..."}</h3>
            <p className="cmp-col-meta">
              {[pick?.year, mediaTypeLabel(pick?.media_type || "movie"),
                typeof pick?.vote === "number" ? `TMDB ${pick.vote.toFixed(1)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {pick?.runtime_label && (
              <p className="cmp-meta-line">
                <span>Duração</span> {pick.runtime_label}
              </p>
            )}
            {pick?.genres_label && (
              <p className="cmp-meta-line">
                <span>Gêneros</span> {pick.genres_label}
              </p>
            )}
            {pick?.directors_label && (
              <p className="cmp-meta-line">
                <span>Direção</span> {pick.directors_label}
              </p>
            )}
            {pick?.countries_label && (
              <p className="cmp-meta-line">
                <span>Países</span> {pick.countries_label}
              </p>
            )}
            {pick?.overview && (
              <p className="cmp-col-overview">{pick.overview}</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default function CompararApp({ initialA, initialB }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pickLeft, setPickLeft] = useState<ComparePick | null>(
    initialA ? emptyPick(initialA.id, initialA.mt) : null
  );
  const [pickRight, setPickRight] = useState<ComparePick | null>(
    initialB ? emptyPick(initialB.id, initialB.mt) : null
  );
  const [pendingSwap, setPendingSwap] = useState<SearchHit | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [common, setCommon] = useState<CompareCommonMember[]>([]);
  const compareAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const bothFilled = !!(pickLeft?.tmdb_id && pickRight?.tmdb_id);

  const runCompare = useCallback(
    async (left: ComparePick | null, right: ComparePick | null) => {
      if (!left?.tmdb_id && !right?.tmdb_id) {
        setCommon([]);
        return;
      }
      if (compareAbortRef.current) compareAbortRef.current.abort();
      const ctl = new AbortController();
      compareAbortRef.current = ctl;
      setCompareLoading(true);
      setCompareError(null);
      try {
        const params: Record<string, string> = {};
        if (left?.tmdb_id) {
          params.a = String(left.tmdb_id);
          params.a_mt = left.media_type;
        }
        if (right?.tmdb_id) {
          params.b = String(right.tmdb_id);
          params.b_mt = right.media_type;
        }
        const data = await apiGet<CompareResponse>("/api/comparar", {
          signal: ctl.signal,
          params,
        });
        if (data.error) {
          setCompareError(data.error);
          return;
        }
        if (data.left) setPickLeft(data.left);
        if (data.right) setPickRight(data.right);
        setCommon(data.common || []);
        syncUrl(data.left ?? left, data.right ?? right);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setCompareError((e as Error).message || "Erro de rede ao comparar.");
      } finally {
        setCompareLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    runCompare(pickLeft, pickRight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setPopoverOpen(false);
      return;
    }
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const ctl = new AbortController();
    searchAbortRef.current = ctl;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await apiGet<{ results: SearchHit[] }>("/search", {
        signal: ctl.signal,
        params: { q, type: "multi" },
      });
      setResults(data.results || []);
      setPopoverOpen(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setResults([]);
      setSearchError((e as Error).message || "Erro na busca TMDB.");
      setPopoverOpen(true);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  function scheduleSearch(v: string) {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => runSearch(v), 280);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    scheduleSearch(v);
  }

  function acceptHit(hit: SearchHit, target?: Slot) {
    const p: ComparePick = {
      tmdb_id: hit.id,
      media_type: hit.media_type === "tv" ? "tv" : "movie",
      title: hit.title,
      poster_path: hit.poster_path || null,
    };
    let nextLeft = pickLeft;
    let nextRight = pickRight;
    if (target === "left" || (!pickLeft && !target)) {
      nextLeft = p;
    } else if (target === "right" || (!pickRight && !target)) {
      nextRight = p;
    } else {
      setPendingSwap(hit);
      return;
    }
    setPickLeft(nextLeft);
    setPickRight(nextRight);
    setQuery("");
    setResults([]);
    setPopoverOpen(false);
    runCompare(nextLeft, nextRight);
  }

  function applySwap(slot: Slot) {
    const hit = pendingSwap;
    setPendingSwap(null);
    if (!hit) return;
    const p: ComparePick = {
      tmdb_id: hit.id,
      media_type: hit.media_type === "tv" ? "tv" : "movie",
      title: hit.title,
      poster_path: hit.poster_path || null,
    };
    let nextLeft = pickLeft;
    let nextRight = pickRight;
    if (slot === "left") nextLeft = p;
    else nextRight = p;
    setPickLeft(nextLeft);
    setPickRight(nextRight);
    setQuery("");
    setResults([]);
    setPopoverOpen(false);
    runCompare(nextLeft, nextRight);
  }

  function clearSlot(slot: Slot) {
    if (slot === "left") {
      if (pickRight) {
        setPickLeft(pickRight);
        setPickRight(null);
        runCompare(pickRight, null);
      } else {
        setPickLeft(null);
        runCompare(null, null);
      }
    } else {
      setPickRight(null);
      runCompare(pickLeft, null);
    }
  }

  function swapSides() {
    const newLeft = pickRight;
    const newRight = pickLeft;
    setPickLeft(newLeft);
    setPickRight(newRight);
    runCompare(newLeft, newRight);
  }

  function syncUrl(left: ComparePick | null, right: ComparePick | null) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("a");
      url.searchParams.delete("a_mt");
      url.searchParams.delete("b");
      url.searchParams.delete("b_mt");
      if (left?.tmdb_id) {
        url.searchParams.set("a", String(left.tmdb_id));
        url.searchParams.set("a_mt", left.media_type);
      }
      if (right?.tmdb_id) {
        url.searchParams.set("b", String(right.tmdb_id));
        url.searchParams.set("b_mt", right.media_type);
      }
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }

  const placeholder = useMemo(
    () => (pickLeft ? "Buscar o 2º título..." : "Buscar o 1º título (ex: Matrix)..."),
    [pickLeft]
  );

  const reduce = useReducedMotion();

  return (
    <div className="rx-root cmp-main">
      <ScrollReveal>
        <header className="cmp-header cmp-header--premium">
          <span className="cmp-eyebrow">
            <Sparkles size={14} /> Duelo cinematográfico
          </span>
          <h1 className="cmp-title">
            <GradientTitle as="span" size="xl" variant="primary" shiny>
              Comparar dois títulos
            </GradientTitle>
          </h1>
          <p className="cmp-lead">
            Busque no TMDB em pt-BR. O <strong>1º</strong> clique entra na coluna esquerda,
            o <strong>2º</strong> na direita. A comparação aparece automaticamente.
          </p>
        </header>
      </ScrollReveal>

      <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
        <Popover.Trigger
          nativeButton={false}
          render={<div className="rx-search cmp-search" />}
        >
          <Search size={18} className="rx-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="rx-search-input"
            value={query}
            onChange={handleInputChange}
            onFocus={() => {
              if (query.trim()) setPopoverOpen(true);
            }}
            placeholder={placeholder}
            autoComplete="off"
            aria-label="Buscar filme ou série"
          />
          {searchLoading && <span className="cmp-search-spinner" aria-hidden="true" />}
          {query && !searchLoading && (
            <button
              type="button"
              className="cmp-search-clear"
              onClick={(e) => {
                e.stopPropagation();
                setQuery("");
                setResults([]);
                setPopoverOpen(false);
                inputRef.current?.focus();
              }}
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start">
            <Popover.Popup className="cmp-popup">
              {searchError ? (
                <p className="cmp-popup-empty cmp-popup-error">{searchError}</p>
              ) : results.length === 0 ? (
                <p className="cmp-popup-empty">
                  {query.trim() ? "Nenhum resultado." : "Digite para buscar..."}
                </p>
              ) : (
                <ul className="cmp-popup-list" role="listbox">
                  {results.map((hit) => (
                    <li key={`${hit.media_type}-${hit.id}`}>
                      <button
                        type="button"
                        className="cmp-popup-item"
                        onClick={() => acceptHit(hit)}
                      >
                        <div className="cmp-popup-thumb">
                          {hit.poster_path ? (
                            <img
                              src={posterUrl(hit.poster_path, "w92")}
                              alt=""
                              width={46}
                              height={69}
                              loading="lazy"
                            />
                          ) : (
                            <span aria-hidden="true">🎬</span>
                          )}
                        </div>
                        <div className="cmp-popup-body">
                          <span className="cmp-popup-title">{hit.title}</span>
                          <span className="cmp-popup-meta">
                            <span className="rx-chip rx-chip--soft">
                              {mediaTypeLabel(hit.media_type)}
                            </span>
                            {hit.release_date && (
                              <span>{String(hit.release_date).slice(0, 4)}</span>
                            )}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {compareError && (
        <p className="cmp-error" role="alert">
          {compareError}
        </p>
      )}

      <section className="cmp-columns">
        <motion.div
          layout
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{ display: "contents" }}
        >
          <PickCard
            slot="left"
            pick={pickLeft}
            onClear={() => clearSlot("left")}
            slotLabel="1º título"
            emptyHint="Busque acima e escolha o primeiro filme ou série."
          />
        </motion.div>
        <motion.button
          type="button"
          className="cmp-swap"
          onClick={swapSides}
          disabled={!bothFilled}
          aria-label="Inverter lados"
          title="Inverter lados"
          whileHover={!reduce && bothFilled ? { rotate: 180 } : undefined}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 240, damping: 18 }}
        >
          <ArrowLeftRight size={16} />
        </motion.button>
        <motion.div
          layout
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          style={{ display: "contents" }}
        >
          <PickCard
            slot="right"
            pick={pickRight}
            onClear={() => clearSlot("right")}
            slotLabel="2º título"
            emptyHint="Depois busque o segundo para comparar."
          />
        </motion.div>
      </section>

      {compareLoading && (
        <p className="cmp-status text-muted" role="status">
          Carregando comparação…
        </p>
      )}

      {bothFilled && (
        <section className="cmp-common rx-panel">
          <h2 className="cmp-subtitle">Elenco em comum</h2>
          {common.length === 0 ? (
            <p className="text-muted">Sem interseção nas primeiras posições do elenco.</p>
          ) : (
            <ul className="cmp-cast-list">
              {common.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog.Root open={!!pendingSwap} onOpenChange={(o) => !o && setPendingSwap(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="cmp-dialog-backdrop" />
          <Dialog.Popup className="cmp-dialog">
            <Dialog.Title className="cmp-dialog-title">
              Substituir qual lado?
            </Dialog.Title>
            <Dialog.Description className="cmp-dialog-desc">
              Você já tem dois títulos. Escolha onde {pendingSwap?.title} vai entrar.
            </Dialog.Description>
            <div className="cmp-dialog-actions">
              <button
                type="button"
                className="rx-btn rx-btn--ghost"
                onClick={() => setPendingSwap(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rx-btn rx-btn--primary"
                onClick={() => applySwap("left")}
              >
                Substituir esquerda
              </button>
              <button
                type="button"
                className="rx-btn rx-btn--primary"
                onClick={() => applySwap("right")}
              >
                Substituir direita
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, useReducedMotion } from "framer-motion";
import { Heart, Sparkles, Users, Check, X, Clapperboard, Tv, Filter, ListFilter } from "lucide-react";
import {
  GradientTitle,
  MagneticButton,
  ScrollReveal,
  Sheet,
  SurfacePanel,
  ToastProvider,
  useToast,
  SegmentedToggle,
  Chip,
  EmptyState,
  Skeleton,
} from "../ds";

interface DeckCard {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  state?: string;
}

interface DeckResponse { deck: DeckCard[]; message?: string }

type SourceMode = "watchlater" | "genre";
type MediaType = "movie" | "tv";

const GENRES: { id: string; label: string; theme: string }[] = [
  { id: "27", label: "Terror", theme: "terror" },
  { id: "18", label: "Drama", theme: "drama" },
  { id: "53", label: "Suspense", theme: "suspense" },
  { id: "28", label: "Ação", theme: "acao" },
  { id: "12", label: "Aventura", theme: "aventura" },
  { id: "16", label: "Animação", theme: "animacao" },
  { id: "878", label: "Ficção científica", theme: "ficcao" },
  { id: "10749", label: "Romance", theme: "romance" },
  { id: "35", label: "Comédia", theme: "comedia" },
  { id: "80", label: "Policial", theme: "crime" },
  { id: "10766", label: "Novela", theme: "novela" },
];

const STATE_LABEL: Record<string, string> = {
  pending: "Novo",
  liked_a: "Curtido por A",
  liked_b: "Curtido por B",
  matched: "Deu match!",
  rejected: "Recusado",
};

function posterUrl(path: string | null | undefined, size = "w342") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function activeProfile(): "a" | "b" {
  try {
    const v = (localStorage.getItem("movies_app_active_profile_slug") || "a").toLowerCase();
    return v === "b" ? "b" : "a";
  } catch {
    return "a";
  }
}

function haptic(pattern: number | number[] = 15) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

function SwipeDeck() {
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const [source, setSource] = useState<SourceMode>("watchlater");
  const [media, setMedia] = useState<MediaType>("movie");
  const [genres, setGenres] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [matchCount, setMatchCount] = useState(0);
  const lastMatchIdRef = useRef(0);

  const deckUrl = useMemo(() => {
    if (source === "watchlater") return "/api/swipe/deck?source=watchlater";
    const ids = Array.from(genres).join(",");
    return `/api/swipe/deck?source=genre&media=${encodeURIComponent(media)}&genre_ids=${encodeURIComponent(ids)}`;
  }, [source, media, genres]);

  const loadDeck = useCallback(() => {
    setLoading(true);
    fetch(deckUrl)
      .then((r) => r.json())
      .then((d: DeckResponse) => {
        setDeck(d.deck || []);
        setIdx(0);
      })
      .catch(() => toast({ title: "Não consegui carregar o deck", kind: "error" }))
      .finally(() => setLoading(false));
  }, [deckUrl, toast]);

  useEffect(() => { loadDeck(); }, [loadDeck]);

  useEffect(() => {
    let timer: number | null = null;
    fetch("/api/swipe/match-cursor")
      .then((r) => r.json())
      .then((d: { last_id: number }) => { lastMatchIdRef.current = d.last_id || 0; })
      .catch(() => { /* ignore */ });
    timer = window.setInterval(() => {
      fetch(`/api/swipe/matches?since_id=${lastMatchIdRef.current}`)
        .then((r) => r.json())
        .then((d: { items: { id: number; title?: string }[] }) => {
          const items = d.items || [];
          items.forEach((it) => {
            lastMatchIdRef.current = Math.max(lastMatchIdRef.current, it.id);
            toast({ title: `Novo match: ${it.title || "título"}`, kind: "success" });
            setMatchCount((n) => n + 1);
          });
        })
        .catch(() => { /* ignore */ });
    }, 2800);
    return () => { if (timer) clearInterval(timer); };
  }, [toast]);

  const current = deck[idx];

  function advance() {
    setIdx((i) => i + 1);
  }

  async function act(action: "like" | "reject", card: DeckCard) {
    haptic(action === "like" ? 12 : [6, 4, 6]);
    try {
      const res = await fetch("/api/swipe/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdb_id: card.tmdb_id,
          media_type: card.media_type,
          profile: activeProfile(),
          action,
          title: card.title,
          poster_path: card.poster_path || "",
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast({ title: j.error || "Ação inválida", kind: "error" });
        return;
      }
      if (j.state === "matched") {
        toast({ title: "Deu match! 💜", kind: "success" });
        setMatchCount((n) => n + 1);
        haptic([20, 40, 30]);
      }
    } catch {
      toast({ title: "Erro ao registrar ação", kind: "error" });
    }
    advance();
  }

  function toggleGenre(id: string) {
    setGenres((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applySheet() {
    if (!genres.size) {
      toast({ title: "Selecione ao menos um gênero", kind: "error" });
      return;
    }
    setSource("genre");
    setSheetOpen(false);
  }

  function resetToWatchlater() {
    setSource("watchlater");
  }

  const atEnd = !loading && (deck.length === 0 || idx >= deck.length);

  return (
    <div className="swipe-root">
      <ScrollReveal>
        <section className="swipe-hero">
          <div className="swipe-hero-aura" aria-hidden="true" />
          <span className="swipe-eyebrow"><Users size={14} /> Modo casal</span>
          <h1 className="swipe-hero-title">
            <GradientTitle as="span" size="xl">O que vamos ver juntos?</GradientTitle>
          </h1>
          <p className="swipe-hero-sub">
            Deslize para curtir ou recusar. Quando os dois amam o mesmo título, é match.
          </p>
          <div className="swipe-hero-stats">
            <div className="swipe-stat">
              <span className="swipe-stat-value">{deck.length}</span>
              <span className="swipe-stat-label">no deck</span>
            </div>
            <div className="swipe-stat">
              <span className="swipe-stat-value">{Math.min(idx, deck.length)}</span>
              <span className="swipe-stat-label">vistos</span>
            </div>
            <div className="swipe-stat swipe-stat--match">
              <span className="swipe-stat-value">{matchCount}</span>
              <span className="swipe-stat-label">matches</span>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <SurfacePanel className="swipe-toolbar">
        <div className="swipe-source-seg">
          <SegmentedToggle<SourceMode>
            value={source}
            onValueChange={(v) => {
              if (v === "genre") {
                setSheetOpen(true);
              } else {
                resetToWatchlater();
              }
            }}
            ariaLabel="Origem do deck"
            options={[
              { value: "watchlater", label: "Ver depois" },
              { value: "genre", label: "Por gênero" },
            ]}
          />
        </div>
        <button type="button" className="swipe-filter-btn" onClick={() => setSheetOpen(true)}>
          <Filter size={16} /> Filtrar
        </button>
      </SurfacePanel>

      <div className="swipe-deck" aria-live="polite">
        {loading ? (
          <div className="swipe-skeleton">
            <Skeleton width="100%" height="100%" rounded="lg" />
          </div>
        ) : atEnd ? (
          <EmptyState
            title="Fim do deck por agora"
            description="Ajuste filtros ou adicione títulos em Ver depois para continuar."
            action={
              <MagneticButton variant="primary" onClick={loadDeck}>
                <ListFilter size={16} /> Recarregar deck
              </MagneticButton>
            }
          />
        ) : (
          <AnimatePresence mode="popLayout">
            {deck.slice(idx, idx + 3).reverse().map((card, offset, arr) => {
              const positionFromTop = arr.length - 1 - offset;
              const isTop = positionFromTop === 0;
              return (
                <Card
                  key={`${card.tmdb_id}-${card.media_type}-${idx + arr.length - 1 - offset}`}
                  card={card}
                  depth={positionFromTop}
                  isTop={isTop}
                  reduce={Boolean(reduce)}
                  onLike={() => act("like", card)}
                  onReject={() => act("reject", card)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {current && !atEnd && !loading && (
        <div className="swipe-actions-row">
          <MagneticButton
            variant="danger"
            onClick={() => act("reject", current)}
            aria-label="Recusar"
          >
            <X size={18} /> Não
          </MagneticButton>
          <MagneticButton
            variant="success"
            onClick={() => act("like", current)}
            aria-label="Curtir"
          >
            <Heart size={18} /> Curtir
          </MagneticButton>
        </div>
      )}

      {current && !atEnd && (
        <p className="swipe-hint">{STATE_LABEL[current.state || "pending"] || "—"}</p>
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={<span><Sparkles size={16} /> Swipe por gênero</span>}
        subtitle="Escolha filme ou série e um ou mais gêneros."
      >
        <div className="swipe-sheet-body">
          <SegmentedToggle<MediaType>
            value={media}
            onValueChange={setMedia}
            ariaLabel="Filme ou série"
            options={[
              { value: "movie", label: "Filmes", icon: <Clapperboard size={14} /> },
              { value: "tv", label: "Séries", icon: <Tv size={14} /> },
            ]}
          />
          <p className="swipe-sheet-count">
            {genres.size === 0 ? "Nenhum gênero selecionado" : `${genres.size} gênero(s) selecionado(s)`}
          </p>
          <div className="swipe-genre-grid">
            {GENRES.map((g) => (
              <Chip
                key={g.id}
                active={genres.has(g.id)}
                onClick={() => toggleGenre(g.id)}
                variant="accent"
              >
                {g.label}
              </Chip>
            ))}
          </div>
          <MagneticButton variant="primary" block onClick={applySheet}>
            <Heart size={16} /> Aplicar e carregar deck
          </MagneticButton>
        </div>
      </Sheet>
    </div>
  );
}

function Card({
  card,
  depth,
  isTop,
  reduce,
  onLike,
  onReject,
}: {
  card: DeckCard;
  depth: number;
  isTop: boolean;
  reduce: boolean;
  onLike: () => void;
  onReject: () => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-14, 0, 14]);
  const likeOpacity = useTransform(x, [0, 120], [0, 1]);
  const passOpacity = useTransform(x, [-120, 0], [1, 0]);

  return (
    <motion.article
      className="swipe-card"
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.94 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: depth * 12, scale: 1 - depth * 0.05 }}
      exit={reduce ? { opacity: 0 } : { x: x.get() > 0 ? 400 : -400, opacity: 0, rotate: x.get() > 0 ? 20 : -20 }}
      transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.8 }}
      style={isTop ? { x, rotate } : undefined}
      drag={isTop && !reduce ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      onDragEnd={(_, info) => {
        if (info.offset.x > 120) onLike();
        else if (info.offset.x < -120) onReject();
      }}
      whileTap={{ cursor: "grabbing" }}
    >
      {card.poster_path ? (
        <img className="swipe-card-poster" src={posterUrl(card.poster_path, "w500")} alt="" />
      ) : (
        <div className="swipe-card-ph">🎬</div>
      )}
      <div className="swipe-card-overlay" aria-hidden="true" />
      <div className="swipe-card-body">
        <span className="swipe-card-chip">{card.media_type === "movie" ? "Filme" : "Série"}</span>
        <h2 className="swipe-card-title">{card.title}</h2>
      </div>
      {isTop && (
        <>
          <motion.span className="swipe-stamp swipe-stamp--like" style={{ opacity: likeOpacity }} aria-hidden="true">
            <Check size={22} /> CURTIDO
          </motion.span>
          <motion.span className="swipe-stamp swipe-stamp--pass" style={{ opacity: passOpacity }} aria-hidden="true">
            <X size={22} /> NOPE
          </motion.span>
        </>
      )}
    </motion.article>
  );
}

export default function SwipeApp() {
  return (
    <ToastProvider>
      <SwipeDeck />
    </ToastProvider>
  );
}

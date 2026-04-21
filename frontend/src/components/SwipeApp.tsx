import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, useReducedMotion } from "framer-motion";
import { Heart, Sparkles, Users, Check, X, Clapperboard, Tv, ListFilter, ArrowLeft, Bookmark } from "lucide-react";
import {
  GradientTitle,
  MagneticButton,
  ScrollReveal,
  SurfacePanel,
  ToastProvider,
  useToast,
  SegmentedToggle,
  EmptyState,
  Skeleton,
  cx,
} from "../ds";
import { appUrl } from "../lib/appBase";
import { SWIPE_GENRE_CHIPS, swipeGenreChipKey, type SwipeGenreChip } from "../lib/swipeGenreChips";

interface DeckCard {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  state?: string;
}

interface SessionPayload {
  active: boolean;
  source?: string;
  media?: string;
  genre_ids?: number[];
  deck?: DeckCard[];
  cursor_index?: number;
  deck_total?: number;
  error?: string;
  session_public_id?: string;
  session_has_tail?: boolean;
  session_waiting?: boolean;
  viewer_profile?: string;
}

type MediaType = "movie" | "tv";
type GateStep = "pick" | "newKind" | "newGenre" | null;

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

/** Deploys antigos podem não ter `POST /api/swipe/session`; o deck legado vem de `GET /api/swipe/deck` (menos cartas). */
async function fetchSwipeDeckLegacy(body: Record<string, unknown>): Promise<SessionPayload | null> {
  const source = String(body.source || "watchlater").toLowerCase();
  if (source !== "watchlater" && source !== "genre") return null;
  const qs = new URLSearchParams({ source });
  if (source === "genre") {
    const media = body.media === "tv" ? "tv" : "movie";
    qs.set("media", media);
    const raw = body.genre_ids;
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : [];
    if (!ids.length) return null;
    qs.set("genre_ids", ids.join(","));
  }
  const res = await fetch(appUrl(`/api/swipe/deck?${qs.toString()}`));
  const rawText = await res.text();
  let data: { deck?: DeckCard[] };
  try {
    data = rawText ? (JSON.parse(rawText) as { deck?: DeckCard[] }) : {};
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const deck = data.deck;
  if (!Array.isArray(deck) || deck.length === 0) return null;
  const gids =
    source === "genre" && Array.isArray(body.genre_ids)
      ? (body.genre_ids as unknown[]).filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : undefined;
  return {
    active: true,
    source: source as "watchlater" | "genre",
    media: body.media === "tv" ? "tv" : "movie",
    genre_ids: gids,
    deck,
    cursor_index: 0,
    deck_total: deck.length,
  };
}

function activeProfile(): "a" | "b" {
  try {
    const v = (localStorage.getItem("movies_app_active_profile_slug") || "a").toLowerCase();
    return v === "b" ? "b" : "a";
  } catch {
    return "a";
  }
}

function swipeSessionUrl(): string {
  const p = activeProfile();
  return appUrl(`/api/swipe/session?profile=${encodeURIComponent(p)}`);
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
  const [source, setSource] = useState<"watchlater" | "genre">("watchlater");
  const [media, setMedia] = useState<MediaType>("movie");
  const [selectedGenreKeys, setSelectedGenreKeys] = useState<Set<string>>(new Set());
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [matchCount, setMatchCount] = useState(0);
  const lastMatchIdRef = useRef(0);
  const lastGenreReloadRef = useRef<{ media: MediaType; genre_ids: number[] } | null>(null);
  /** Sem `POST /api/swipe/session` no servidor: deck via GET legado; não chamar refresh pós-ação (sessão inexistente). */
  const legacySwipeRef = useRef(false);
  const [gate, setGate] = useState<GateStep>("pick");
  const [pendingSession, setPendingSession] = useState<SessionPayload | null>(null);
  /** Sessão ativa mas fila deste perfil vazia (ex.: outro já curtiu — à espera da resposta). */
  const [sessionWaitOnly, setSessionWaitOnly] = useState(false);

  useEffect(() => {
    if (gate !== "newGenre") {
      document.body.setAttribute("data-genre-theme", "default");
      return;
    }
    if (selectedGenreKeys.size === 0) {
      document.body.setAttribute("data-genre-theme", "default");
      return;
    }
    if (selectedGenreKeys.size === 1) {
      const k = [...selectedGenreKeys][0];
      const chip = SWIPE_GENRE_CHIPS.find((c) => swipeGenreChipKey(c) === k);
      document.body.setAttribute("data-genre-theme", chip?.theme || "default");
    } else {
      document.body.setAttribute("data-genre-theme", "default");
    }
  }, [gate, selectedGenreKeys]);

  const refreshSessionDeck = useCallback(async () => {
    if (legacySwipeRef.current) {
      return true;
    }
    try {
      const r = await fetch(swipeSessionUrl());
      const d = (await r.json()) as SessionPayload;
      if (d.active) {
        const next = d.deck || [];
        if (next.length) {
          setSessionWaitOnly(false);
          setDeck(next);
          setIdx(0);
        } else if (d.session_waiting) {
          setSessionWaitOnly(true);
          setDeck([]);
          setIdx(0);
        } else {
          setSessionWaitOnly(false);
          setDeck([]);
          setIdx(0);
        }
        return true;
      }
      setSessionWaitOnly(false);
      setDeck([]);
      setIdx(0);
      return false;
    } catch {
      toast({ title: "Não consegui sincronizar o deck", kind: "error" });
      return false;
    }
  }, [toast]);

  const applyStartedSession = useCallback((d: SessionPayload, body: Record<string, unknown>) => {
    if (body.source === "genre" && Array.isArray(body.genre_ids)) {
      const ids = (body.genre_ids as unknown[]).filter((x): x is number => typeof x === "number");
      lastGenreReloadRef.current = {
        media: (body.media as MediaType) || "movie",
        genre_ids: ids,
      };
    } else {
      lastGenreReloadRef.current = null;
    }
    setDeck(d.deck || []);
    setIdx(0);
    setGate(null);
    setPendingSession(null);
    setSessionWaitOnly(false);
    if (body.source === "genre") setSource("genre");
    if (body.source === "watchlater") setSource("watchlater");
  }, []);

  const startSession = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setLoading(true);
      try {
        const r = await fetch(appUrl("/api/swipe/session"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, viewer: activeProfile() }),
        });
        const text = await r.text();
        let d: SessionPayload = {};

        const tryLegacyDeck = async (): Promise<boolean> => {
          if (r.status !== 404 && r.status !== 405) return false;
          const leg = await fetchSwipeDeckLegacy(body);
          if (!leg?.deck?.length) return false;
          legacySwipeRef.current = true;
          toast({
            title: "Backend desatualizado",
            description:
              "O servidor não tem POST /api/swipe/session. A usar deck legado (até 20 títulos). Atualize o código no Raspberry Pi e reinicie o Gunicorn.",
            kind: "info",
          });
          applyStartedSession(leg, body);
          return true;
        };

        try {
          d = text ? (JSON.parse(text) as SessionPayload) : {};
        } catch {
          if (await tryLegacyDeck()) return true;
          toast({
            title: "Resposta inválida do servidor",
            description: text ? text.slice(0, 160) : undefined,
            kind: "error",
          });
          return false;
        }
        if (!r.ok) {
          if (await tryLegacyDeck()) return true;
          toast({ title: d.error || "Não foi possível iniciar a sessão", kind: "error" });
          return false;
        }
        legacySwipeRef.current = false;
        if (d.session_waiting && !(d.deck?.length ?? 0)) {
          setSessionWaitOnly(true);
          setDeck([]);
          setIdx(0);
          setGate(null);
          setPendingSession(null);
          if (d.source === "genre") setSource("genre");
          if (d.source === "watchlater") setSource("watchlater");
        } else {
          setSessionWaitOnly(false);
          applyStartedSession(d, body);
        }
        return true;
      } catch {
        toast({
          title: "Erro de rede ou timeout",
          description:
            "Com vários géneros o servidor pode demorar a montar o deck. Tenta de novo dentro de instantes.",
          kind: "error",
        });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [toast, applyStartedSession]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(swipeSessionUrl())
      .then((r) => r.json())
      .then((d: SessionPayload) => {
        if (cancelled) return;
        const canResume = Boolean(
          d.active && ((d.deck?.length ?? 0) > 0 || Boolean(d.session_waiting))
        );
        setPendingSession(canResume ? d : null);
        setDeck([]);
        setIdx(0);
        setGate("pick");
      })
      .catch(() => {
        if (!cancelled) {
          setPendingSession(null);
          setDeck([]);
          setIdx(0);
          setGate("pick");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (gate !== "pick") return undefined;
    const tick = () => {
      fetch(swipeSessionUrl())
        .then((r) => r.json())
        .then((d: SessionPayload) => {
          const canResume = Boolean(
            d.active && ((d.deck?.length ?? 0) > 0 || Boolean(d.session_waiting))
          );
          setPendingSession(canResume ? d : null);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 2500);
    return () => clearInterval(id);
  }, [gate]);

  useEffect(() => {
    if (!sessionWaitOnly || legacySwipeRef.current) return undefined;
    const id = window.setInterval(() => {
      void refreshSessionDeck();
    }, 2800);
    return () => clearInterval(id);
  }, [sessionWaitOnly, refreshSessionDeck]);

  const endSession = useCallback(async () => {
    legacySwipeRef.current = false;
    setSessionWaitOnly(false);
    try {
      await fetch(appUrl("/api/swipe/session/end"), { method: "POST" });
    } catch {
      /* ignore */
    }
    setPendingSession(null);
    setDeck([]);
    setIdx(0);
    setGate("pick");
  }, []);

  const continueSession = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(swipeSessionUrl());
      const d = (await r.json()) as SessionPayload;
      if (!d.active) {
        toast({ title: "Já não há sessão ativa", kind: "error" });
        setPendingSession(null);
        return;
      }
      if (d.session_waiting && !(d.deck?.length ?? 0)) {
        setSessionWaitOnly(true);
        setDeck([]);
        setIdx(0);
        setGate(null);
        setPendingSession(null);
        return;
      }
      if ((d.deck?.length ?? 0) > 0) {
        setSessionWaitOnly(false);
        setDeck(d.deck as DeckCard[]);
        setIdx(0);
        setGate(null);
        setPendingSession(null);
        return;
      }
      toast({ title: "Nada para mostrar neste perfil", kind: "info" });
    } catch {
      toast({ title: "Erro ao entrar na sessão", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let timer: number | null = null;
    fetch(appUrl("/api/swipe/match-cursor"))
      .then((r) => r.json())
      .then((d: { last_id: number }) => {
        lastMatchIdRef.current = d.last_id || 0;
      })
      .catch(() => {
        /* ignore */
      });
    timer = window.setInterval(() => {
      fetch(appUrl(`/api/swipe/matches?since_id=${lastMatchIdRef.current}`))
        .then((r) => r.json())
        .then((d: { items: { id: number; title?: string }[] }) => {
          const items = d.items || [];
          items.forEach((it) => {
            lastMatchIdRef.current = Math.max(lastMatchIdRef.current, it.id);
            toast({ title: `Novo match: ${it.title || "título"}`, kind: "success" });
            setMatchCount((n) => n + 1);
          });
        })
        .catch(() => {
          /* ignore */
        });
    }, 2800);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [toast]);

  const current = deck[idx];

  async function act(action: "like" | "reject", card: DeckCard) {
    haptic(action === "like" ? 12 : [6, 4, 6]);
    try {
      const res = await fetch(appUrl("/api/swipe/action"), {
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
      if (legacySwipeRef.current) {
        setIdx((i) => i + 1);
      } else {
        await refreshSessionDeck();
      }
    } catch {
      toast({ title: "Erro ao registrar ação", kind: "error" });
    }
  }

  function toggleGenreChip(chip: SwipeGenreChip) {
    const key = swipeGenreChipKey(chip);
    setSelectedGenreKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (chip.genreId === "10766") setMedia("tv");
  }

  const novelaSelected = selectedGenreKeys.has("g:10766");
  const effectiveMedia: MediaType = novelaSelected ? "tv" : media;

  async function confirmGenreSession() {
    if (!selectedGenreKeys.size) {
      toast({ title: "Selecione pelo menos um gênero", kind: "error" });
      return;
    }
    const ids = [...selectedGenreKeys]
      .filter((k) => k.startsWith("g:"))
      .map((k) => parseInt(k.slice(2), 10))
      .filter((n) => !Number.isNaN(n));
    if (!ids.length) {
      toast({ title: "Escolha gêneros TMDB (os chips com ícone)", kind: "error" });
      return;
    }
    const ok = await startSession({
      source: "genre",
      media: effectiveMedia,
      genre_ids: ids,
    });
    if (ok) setSelectedGenreKeys(new Set());
  }

  const atEnd =
    !loading && !sessionWaitOnly && (deck.length === 0 || idx >= deck.length);

  async function onIniciarNovaSessao() {
    await endSession();
    setSelectedGenreKeys(new Set());
    setGate("newKind");
  }

  if (gate === "pick") {
    const myQueue = pendingSession?.deck?.length ?? 0;
    const total = pendingSession?.deck_total ?? 0;
    const sid = (pendingSession?.session_public_id || "").trim();
    const sidShort = sid.length >= 8 ? `${sid.slice(0, 8)}…` : sid;
    const canContinue = Boolean(
      pendingSession?.active &&
      (myQueue > 0 || Boolean(pendingSession.session_waiting))
    );
    const sessionHint = !pendingSession?.active
      ? " Ainda não há sessão ativa: usa “Iniciar nova sessão”."
      : pendingSession.session_waiting
        ? " Há uma sessão em curso; neste perfil estás à espera da resposta do outro nas cartas atuais — podes entrar na mesma sala."
        : myQueue > 0
          ? ` Há sessão ativa: ${myQueue} título(s) na tua fila${total ? ` (de ~${total} no deck)` : ""}.`
          : " Há sessão ativa mas sem cartas visíveis para este perfil.";
    return (
      <div className="swipe-root">
        <ScrollReveal>
          <SurfacePanel className="swipe-session-gate" variant="plate" aura>
            <span className="swipe-eyebrow"><Users size={14} /> Sessão do swipe</span>
            <h2 className="swipe-gate-title">Sessão partilhada</h2>
            {sid ? (
              <p className="swipe-hero-sub swipe-session-id-line">
                <strong>Sessão</strong> <code className="swipe-session-code">{sidShort}</code>
                {" — id único desta rodada (novo a cada “Iniciar nova sessão”)."}
              </p>
            ) : null}
            <p className="swipe-hero-sub">
              O mesmo deck para os <strong>dois perfis</strong> e para qualquer telemóvel — assim os matches batem certo.
              {sessionHint}
            </p>
            <div className="swipe-gate-actions swipe-gate-actions--three">
              <MagneticButton variant="primary" onClick={() => void onIniciarNovaSessao()}>
                <Sparkles size={16} /> Iniciar nova sessão
              </MagneticButton>
              <MagneticButton variant="glass" disabled={!canContinue} onClick={() => void continueSession()}>
                <Heart size={16} /> Entrar na sessão atual
              </MagneticButton>
              <MagneticButton variant="ghost" onClick={() => void endSession()}>
                Encerrar sessão
              </MagneticButton>
            </div>
          </SurfacePanel>
        </ScrollReveal>
      </div>
    );
  }

  if (gate === "newKind") {
    return (
      <div className="swipe-root">
        <ScrollReveal>
          <SurfacePanel className="swipe-session-gate" variant="plate" aura>
            <span className="swipe-eyebrow"><Sparkles size={14} /> Nova sessão</span>
            <h2 className="swipe-gate-title">Base do deck</h2>
            <p className="swipe-hero-sub">
              Escolha se o swipe vem da lista <strong>Ver depois</strong> ou de sugestões <strong>por gênero TMDB</strong>.
            </p>
            <div className="swipe-new-kind-grid">
              <button
                type="button"
                className="swipe-new-kind-tile"
                onClick={() => void startSession({ source: "watchlater" })}
              >
                <span className="swipe-new-kind-icon" aria-hidden="true"><Bookmark size={28} /></span>
                <span className="swipe-new-kind-title">Ver depois</span>
                <span className="swipe-new-kind-desc">Títulos que já guardaram para ver juntos</span>
              </button>
              <button
                type="button"
                className="swipe-new-kind-tile swipe-new-kind-tile--accent"
                onClick={() => {
                  setSelectedGenreKeys(new Set());
                  setGate("newGenre");
                }}
              >
                <span className="swipe-new-kind-icon" aria-hidden="true"><Clapperboard size={28} /></span>
                <span className="swipe-new-kind-title">Por gênero</span>
                <span className="swipe-new-kind-desc">Filme ou série + gêneros (cores e ícones como no resto do app)</span>
              </button>
            </div>
            <MagneticButton variant="ghost" className="swipe-gate-back" onClick={() => setGate("pick")}>
              <ArrowLeft size={16} /> Voltar
            </MagneticButton>
          </SurfacePanel>
        </ScrollReveal>
      </div>
    );
  }

  if (gate === "newGenre") {
    return (
      <div className="swipe-root">
        <ScrollReveal>
          <SurfacePanel className="swipe-session-gate swipe-session-gate--wide" variant="plate" aura>
            <span className="swipe-eyebrow"><Sparkles size={14} /> Por género</span>
            <h2 className="swipe-gate-title">Filme ou série + gêneros</h2>
            <p className="swipe-hero-sub">Selecione um ou mais chips. Novela força séries (TV).</p>
            <div className={cx("swipe-genre-toolbar", novelaSelected && "swipe-genre-toolbar--novela")}>
              <SegmentedToggle<MediaType>
                value={novelaSelected ? "tv" : media}
                onValueChange={(v) => {
                  if (!novelaSelected) setMedia(v);
                }}
                ariaLabel="Filme ou série"
                options={[
                  { value: "movie", label: "Filmes", icon: <Clapperboard size={14} /> },
                  { value: "tv", label: "Séries", icon: <Tv size={14} /> },
                ]}
              />
              {novelaSelected ? (
                <p className="swipe-genre-toolbar-hint">Novela usa sempre séries (TV).</p>
              ) : null}
            </div>
            <p className="swipe-sheet-count">
              {selectedGenreKeys.size === 0
                ? "Nenhum gênero selecionado"
                : `${selectedGenreKeys.size} gênero(s) selecionado(s)`}
            </p>
            <div className="swipe-genre-select-grid">
              {SWIPE_GENRE_CHIPS.map((chip) => {
                const key = swipeGenreChipKey(chip);
                const active = selectedGenreKeys.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={cx("swipe-genre-tile", active && "is-active")}
                    data-theme={chip.theme}
                    onClick={() => toggleGenreChip(chip)}
                  >
                    <span className="swipe-genre-tile-emoji" aria-hidden="true">{chip.emoji}</span>
                    <span className="swipe-genre-tile-label">{chip.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="swipe-gate-actions">
              <MagneticButton variant="primary" block onClick={() => void confirmGenreSession()}>
                <Heart size={16} /> Iniciar swipe com este deck
              </MagneticButton>
              <MagneticButton variant="ghost" onClick={() => setGate("newKind")}>
                <ArrowLeft size={16} /> Voltar
              </MagneticButton>
            </div>
          </SurfacePanel>
        </ScrollReveal>
      </div>
    );
  }

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
        <MagneticButton variant="glass" size="sm" onClick={() => setGate("pick")}>
          <Users size={14} /> Sessão
        </MagneticButton>
        {deck.length > 0 || sessionWaitOnly ? (
          <button type="button" className="swipe-filter-btn swipe-filter-btn--danger" onClick={() => void endSession()}>
            Encerrar sessão
          </button>
        ) : null}
      </SurfacePanel>

      <div className="swipe-deck" aria-live="polite">
        {loading ? (
          <div className="swipe-skeleton">
            <Skeleton width="100%" height="100%" rounded="lg" />
          </div>
        ) : sessionWaitOnly ? (
          <EmptyState
            title="À espera do outro perfil"
            description="Há cartas em curso nesta sessão; o teu perfil já respondeu ou ainda não é a tua vez. Atualizamos automaticamente — ou abre “Sessão” e volta."
            action={
              <MagneticButton variant="primary" onClick={() => void refreshSessionDeck()}>
                <ListFilter size={16} /> Atualizar agora
              </MagneticButton>
            }
          />
        ) : atEnd ? (
          <EmptyState
            title="Fim do deck por agora"
            description="Abre “Sessão” para criar uma nova ou recarrega com a mesma origem."
            action={
              <MagneticButton
                variant="primary"
                onClick={() => {
                  const g = lastGenreReloadRef.current;
                  void (source === "genre" && g?.genre_ids?.length
                    ? startSession({
                        source: "genre",
                        media: g.media,
                        genre_ids: g.genre_ids,
                      })
                    : startSession({ source: "watchlater" }));
                }}
              >
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
          <MagneticButton variant="danger" onClick={() => act("reject", current)} aria-label="Recusar">
            <X size={18} /> Não
          </MagneticButton>
          <MagneticButton variant="success" onClick={() => act("like", current)} aria-label="Curtir">
            <Heart size={18} /> Curtir
          </MagneticButton>
        </div>
      )}

      {current && !atEnd && (
        <p className="swipe-hint">{STATE_LABEL[current.state || "pending"] || "—"}</p>
      )}
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

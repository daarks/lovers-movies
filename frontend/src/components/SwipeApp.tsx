import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, useReducedMotion } from "framer-motion";
import {
  Heart,
  Sparkles,
  Users,
  Check,
  X,
  Clapperboard,
  Tv,
  ListFilter,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import {
  GradientTitle,
  MagneticButton,
  ScrollReveal,
  Sheet,
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
import { useSwipeStream, type MatchSSEEvent } from "../hooks/useSwipeStream";

interface DeckCard {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  state?: string;
}

interface SwipeCardMeta {
  overview: string;
  cast_top: string[];
}

interface SessionPayload {
  active: boolean;
  source?: string;
  media?: string;
  genre_ids?: number[];
  list_id?: number | null;
  deck?: DeckCard[];
  cursor_index?: number;
  cursor_index_a?: number;
  cursor_index_b?: number;
  deck_total?: number;
  error?: string;
  session_public_id?: string;
  session_has_tail?: boolean;
  session_waiting?: boolean;
  viewer_profile?: string;
}

interface ActiveProfilePayload {
  slug: "a" | "b" | null;
  labels?: Record<string, string>;
}

interface SessionMatchItem {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
}

interface SessionMatchesPayload {
  session_public_id: string;
  items: SessionMatchItem[];
}

type MediaType = "movie" | "tv";
type GateStep = "pick" | "newKind" | "newGenre" | null;

function posterUrl(path: string | null | undefined, size = "w342") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/** Deploys antigos podem não ter `POST /api/swipe/session`; o deck legado vem de `GET /api/swipe/deck` (menos cartas). */
async function fetchSwipeDeckLegacy(body: Record<string, unknown>): Promise<SessionPayload | null> {
  const source = String(body.source || "watchlater").toLowerCase();
  if (source !== "watchlater" && source !== "genre" && source !== "list") return null;
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
  if (source === "list") {
    const lid = body.list_id;
    if (typeof lid !== "number" || !Number.isFinite(lid)) return null;
    qs.set("list_id", String(lid));
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
    source: source as "watchlater" | "genre" | "list",
    media: body.media === "tv" ? "tv" : "movie",
    genre_ids: gids,
    list_id: source === "list" && typeof body.list_id === "number" ? body.list_id : undefined,
    deck,
    cursor_index: 0,
    deck_total: deck.length,
  };
}

function readStoredViewerProfile(): "a" | "b" {
  try {
    const v = (localStorage.getItem("movies_app_active_profile_slug") || "a").toLowerCase();
    return v === "b" ? "b" : "a";
  } catch {
    return "a";
  }
}

/** Espelha a regra do servidor: cada perfil só vê cartas em que ainda pode agir. */
function filterDeckForProfile(deck: DeckCard[], profile: "a" | "b"): DeckCard[] {
  return deck.filter((c) => {
    const st = (c.state || "pending").toLowerCase();
    if (st === "matched" || st === "rejected" || st === "no_match") return false;
    if (st === "pending") return true;
    if (st === "liked_a") return profile === "b";
    if (st === "liked_b") return profile === "a";
    if (st === "rejected_a") return profile === "b";
    if (st === "rejected_b") return profile === "a";
    return true;
  });
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
  /** Perfil vindo da sessão Flask (mesmo fluxo que Bem-vindo / menu do topo). */
  const [swipeActor, setSwipeActor] = useState<{ slug: "a" | "b"; label: string } | null>(null);
  const [source, setSource] = useState<"watchlater" | "genre" | "list">("watchlater");
  const [media, setMedia] = useState<MediaType>("movie");
  const [selectedGenreKeys, setSelectedGenreKeys] = useState<Set<string>>(new Set());
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [matchCount, setMatchCount] = useState(0);
  const [sessionMatches, setSessionMatches] = useState<SessionMatchItem[]>([]);
  const [sessionMatchesSid, setSessionMatchesSid] = useState("");
  const seenSessionMatchIdsRef = useRef<Set<number>>(new Set());
  const lastGenreReloadRef = useRef<{ media: MediaType; genre_ids: number[] } | null>(null);
  const lastListDeckRef = useRef<{ watchlater?: true; list_id?: number }>({ watchlater: true });
  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [listPickerData, setListPickerData] = useState<{
    builtin: { name: string; item_count: number };
    custom: { id: number; name: string; item_count: number }[];
  } | null>(null);
  /** Sem `POST /api/swipe/session` no servidor: deck via GET legado; não chamar refresh pós-ação (sessão inexistente). */
  const legacySwipeRef = useRef(false);
  const [sseDisabled, setSseDisabled] = useState(false);
  const [liveSessionPublicId, setLiveSessionPublicId] = useState("");
  const [profileLabels, setProfileLabels] = useState<Record<string, string>>({
    a: "Princesinha",
    b: "Gabe",
  });
  const [liveCursors, setLiveCursors] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [deckTotalLive, setDeckTotalLive] = useState(0);
  const [partnerVoteFlash, setPartnerVoteFlash] = useState(false);
  const [partnerPillEnter, setPartnerPillEnter] = useState(false);
  const [matchOverlay, setMatchOverlay] = useState<MatchSSEEvent | null>(null);
  const lastVoteSigRef = useRef("");
  const lastMatchSigRef = useRef("");
  const prevPartnerOnlineRef = useRef(false);
  /** Evita dois POST /api/swipe/action ao mesmo tempo (duplo toque / arrastar). */
  const actBusyRef = useRef(false);
  /** Descarta respostas GET antigas se outro refresh começou depois. */
  const deckFetchSerialRef = useRef(0);
  /** Agrupa vários pedidos de resync (SSE + reconexão + voto) num único GET. */
  const deckResyncTimerRef = useRef<number | null>(null);
  const gateRef = useRef<GateStep>("pick");
  const [gate, setGate] = useState<GateStep>("pick");
  const [pendingSession, setPendingSession] = useState<SessionPayload | null>(null);
  /** Sessão ativa mas fila deste perfil vazia (ex.: outro já curtiu — aguardando resposta). */
  const [sessionWaitOnly, setSessionWaitOnly] = useState(false);
  const [cardMetaMap, setCardMetaMap] = useState<Record<string, SwipeCardMeta>>({});
  const cardMetaCacheRef = useRef<Map<string, SwipeCardMeta>>(new Map());
  const cardMetaInFlightRef = useRef<Set<string>>(new Set());
  const [cardMetaFetch, setCardMetaFetch] = useState<{ key: string; status: "idle" | "loading" | "error" }>({
    key: "",
    status: "idle",
  });
  const [cardMetaExpanded, setCardMetaExpanded] = useState(false);

  useEffect(() => {
    gateRef.current = gate;
  }, [gate]);

  const fetchSwipeSession = useCallback(
    () =>
      fetch(appUrl("/api/swipe/session"), {
        credentials: "include",
        cache: "no-store",
      }),
    []
  );

  const profileFromPayload = (d: SessionPayload): "a" | "b" =>
    d.viewer_profile === "b" ? "b" : "a";

  /**
   * Guardamos o sid atual em ref para estabilizar `refreshSessionMatches`.
   * Sem isso, a callback é recriada a cada `setSessionMatchesSid`, invalidando
   * useEffects que dependem dela — gerando loops e, pior, caindo de volta
   * para a tela de "Sessão" logo após criar uma nova sessão.
   */
  const sessionMatchesSidRef = useRef("");
  useEffect(() => {
    sessionMatchesSidRef.current = sessionMatchesSid;
  }, [sessionMatchesSid]);

  const refreshSessionMatches = useCallback(
    async (showToasts: boolean) => {
      try {
        const r = await fetch(appUrl("/api/swipe/session/matches"), {
          credentials: "include",
          cache: "no-store",
        });
        const d = (await r.json()) as SessionMatchesPayload;
        const sid = String(d.session_public_id || "");
        if (sid !== sessionMatchesSidRef.current) {
          seenSessionMatchIdsRef.current = new Set<number>();
        }
        const items = Array.isArray(d.items) ? d.items : [];
        if (showToasts) {
          for (const it of items) {
            if (!seenSessionMatchIdsRef.current.has(it.id)) {
              toast({ title: `Novo match: ${it.title || "título"}`, kind: "success" });
            }
          }
        }
        seenSessionMatchIdsRef.current = new Set<number>(items.map((it) => it.id));
        setSessionMatchesSid(sid);
        setSessionMatches(items);
        setMatchCount(items.length);
      } catch {
        /* ignore */
      }
    },
    [toast]
  );

  useEffect(() => {
    if (gate !== "newKind") return;
    let cancelled = false;
    fetch(appUrl("/api/media-lists"), { credentials: "include" })
      .then((r) => r.json())
      .then((d: { builtin?: { name: string; item_count: number }; custom?: { id: number; name: string; item_count: number }[] }) => {
        if (cancelled || !d?.builtin) return;
        setListPickerData({
          builtin: { name: d.builtin.name, item_count: d.builtin.item_count },
          custom: Array.isArray(d.custom) ? d.custom : [],
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gate]);

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
      const r = await fetchSwipeSession();
      const d = (await r.json()) as SessionPayload;
      if (d.active) {
        const sid = String(d.session_public_id || "").trim();
        setLiveSessionPublicId(sid);
        const dt = typeof d.deck_total === "number" ? d.deck_total : 0;
        setDeckTotalLive(dt);
        const ca = typeof d.cursor_index_a === "number" ? d.cursor_index_a : 0;
        const cb = typeof d.cursor_index_b === "number" ? d.cursor_index_b : 0;
        setLiveCursors({ a: ca, b: cb });
        const prof = profileFromPayload(d);
        const raw = (d.deck || []) as DeckCard[];
        const next = filterDeckForProfile(raw, prof);
        const waiting =
          Boolean(d.session_waiting) ||
          (raw.length > 0 && next.length === 0);
        if (next.length) {
          setSessionWaitOnly(false);
          setDeck(next);
          setIdx(0);
        } else if (waiting) {
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
      setLiveSessionPublicId("");
      setDeckTotalLive(0);
      setSessionWaitOnly(false);
      setDeck([]);
      setIdx(0);
      return false;
    } catch {
      toast({ title: "Não deu para sincronizar o deck", kind: "error" });
      return false;
    }
  }, [toast, fetchSwipeSession]);

  /**
   * Agenda um único resync do deck dentro de `delayMs`. Se outro pedido
   * aparecer nesse intervalo (ex.: vários eventos SSE seguidos), ele
   * substitui o agendamento anterior e só faz UM GET. Nunca dispara
   * durante o gate de seleção para não competir com os pollings de "pick".
   */
  const scheduleDebouncedDeckResync = useCallback(
    (delayMs: number) => {
      if (legacySwipeRef.current) return;
      if (gateRef.current !== null) return;
      if (deckResyncTimerRef.current != null) {
        window.clearTimeout(deckResyncTimerRef.current);
      }
      deckResyncTimerRef.current = window.setTimeout(() => {
        deckResyncTimerRef.current = null;
        if (legacySwipeRef.current || gateRef.current !== null) return;
        void refreshSessionDeck();
      }, delayMs);
    },
    [refreshSessionDeck]
  );

  useEffect(() => {
    return () => {
      if (deckResyncTimerRef.current != null) {
        window.clearTimeout(deckResyncTimerRef.current);
        deckResyncTimerRef.current = null;
      }
    };
  }, []);

  const applyStartedSession = useCallback((d: SessionPayload, body: Record<string, unknown>) => {
    if (body.source === "genre" && Array.isArray(body.genre_ids)) {
      const ids = (body.genre_ids as unknown[]).filter((x): x is number => typeof x === "number");
      lastGenreReloadRef.current = {
        media: (body.media as MediaType) || "movie",
        genre_ids: ids,
      };
      lastListDeckRef.current = { watchlater: true };
    } else {
      lastGenreReloadRef.current = null;
      if (body.source === "list" && typeof body.list_id === "number") {
        lastListDeckRef.current = { list_id: body.list_id };
      } else {
        lastListDeckRef.current = { watchlater: true };
      }
    }
    setDeck(filterDeckForProfile((d.deck || []) as DeckCard[], profileFromPayload(d)));
    setIdx(0);
    setGate(null);
    setPendingSession(null);
    setSessionWaitOnly(false);
    setSseDisabled(false);
    setLiveSessionPublicId(String(d.session_public_id || "").trim());
    const dt = typeof d.deck_total === "number" ? d.deck_total : 0;
    setDeckTotalLive(dt);
    const ca = typeof d.cursor_index_a === "number" ? d.cursor_index_a : 0;
    const cb = typeof d.cursor_index_b === "number" ? d.cursor_index_b : 0;
    setLiveCursors({ a: ca, b: cb });
    if (body.source === "genre") setSource("genre");
    if (body.source === "watchlater") setSource("watchlater");
    if (body.source === "list") setSource("list");
  }, []);

  const startSession = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setLoading(true);
      try {
        const r = await fetch(appUrl("/api/swipe/session"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await r.text();
        let d: SessionPayload = { active: false };

        const tryLegacyDeck = async (): Promise<boolean> => {
          if (r.status !== 404 && r.status !== 405) return false;
          const leg = await fetchSwipeDeckLegacy(body);
          if (!leg?.deck?.length) return false;
          legacySwipeRef.current = true;
          setSseDisabled(true);
          setLiveSessionPublicId("");
          toast({
            title: "Backend desatualizado",
            description:
              "O servidor não tem POST /api/swipe/session. Estamos no deck legado (até 20 títulos). Atualize o código no Raspberry Pi e reinicie o Gunicorn.",
            kind: "info",
          });
          applyStartedSession(leg, body);
          return true;
        };

        try {
          d = text ? (JSON.parse(text) as SessionPayload) : { active: false };
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
        setSseDisabled(false);
        if (d.session_waiting && !(d.deck?.length ?? 0)) {
          setSessionWaitOnly(true);
          setDeck([]);
          setIdx(0);
          setGate(null);
          setPendingSession(null);
          setSseDisabled(false);
          setLiveSessionPublicId(String(d.session_public_id || "").trim());
          const dtW = typeof d.deck_total === "number" ? d.deck_total : 0;
          setDeckTotalLive(dtW);
          const caW = typeof d.cursor_index_a === "number" ? d.cursor_index_a : 0;
          const cbW = typeof d.cursor_index_b === "number" ? d.cursor_index_b : 0;
          setLiveCursors({ a: caW, b: cbW });
          if (d.source === "genre") setSource("genre");
          if (d.source === "watchlater") setSource("watchlater");
          if (d.source === "list") setSource("list");
        } else {
          setSessionWaitOnly(false);
          applyStartedSession(d, body);
        }
        return true;
      } catch {
        toast({
          title: "Erro de rede ou timeout",
          description:
            "Com vários gêneros o servidor pode demorar para montar o deck. Tente de novo em alguns instantes.",
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
    (async () => {
      try {
        const r = await fetch(appUrl("/api/active-profile"), { credentials: "include" });
        const j = (await r.json()) as ActiveProfilePayload;
        if (cancelled) return;
        let slug: "a" | "b" | null = j.slug === "b" ? "b" : j.slug === "a" ? "a" : null;
        let labels = j.labels || {};
        if (!slug) {
          const ls = readStoredViewerProfile();
          try {
            await fetch(appUrl("/api/active-profile"), {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slug: ls }),
            });
          } catch {
            /* ignore */
          }
          const r2 = await fetch(appUrl("/api/active-profile"), { credentials: "include" });
          const j2 = (await r2.json()) as ActiveProfilePayload;
          if (cancelled) return;
          slug = j2.slug === "b" ? "b" : j2.slug === "a" ? "a" : null;
          labels = j2.labels || labels;
        }
        if (!slug) {
          window.location.href = appUrl("/bem-vindo");
          return;
        }
        const label =
          (labels[slug] as string | undefined) ||
          (slug === "b" ? "Gabe" : "Princesinha");
        setProfileLabels({
          a: String(labels.a || "Princesinha"),
          b: String(labels.b || "Gabe"),
        });
        try {
          localStorage.setItem("movies_app_active_profile_slug", slug);
        } catch {
          /* ignore */
        }
        setSwipeActor({ slug, label: String(label) });
      } catch {
        if (!cancelled) {
          toast({ title: "Não foi possível carregar o perfil.", kind: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  /**
   * Boot: só deve rodar quando `swipeActor` aparece. NÃO pode depender de
   * `refreshSessionMatches` — ela muda quando o sid muda, e isso derruba o
   * gate de volta para "pick" logo após iniciar uma sessão nova.
   */
  const refreshSessionMatchesRef = useRef(refreshSessionMatches);
  useEffect(() => {
    refreshSessionMatchesRef.current = refreshSessionMatches;
  }, [refreshSessionMatches]);

  useEffect(() => {
    if (!swipeActor) return;
    let cancelled = false;
    setLoading(true);
    fetchSwipeSession()
      .then((r) => r.json())
      .then((d: SessionPayload) => {
        if (cancelled) return;
        const raw = d.deck || [];
        const mine = filterDeckForProfile(raw as DeckCard[], profileFromPayload(d));
        const canResume = Boolean(
          d.active && (mine.length > 0 || Boolean(d.session_waiting) || raw.length > 0)
        );
        setPendingSession(canResume ? d : null);
        setDeck([]);
        setIdx(0);
        setGate("pick");
        void refreshSessionMatchesRef.current(false);
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
  }, [swipeActor, fetchSwipeSession]);

  useEffect(() => {
    if (gate !== "pick" || !swipeActor) return undefined;
    const tick = () => {
      fetchSwipeSession()
        .then((r) => r.json())
        .then((d: SessionPayload) => {
          const raw = d.deck || [];
          const mine = filterDeckForProfile(raw as DeckCard[], profileFromPayload(d));
          const canResume = Boolean(
            d.active && (mine.length > 0 || Boolean(d.session_waiting) || raw.length > 0)
          );
          setPendingSession(canResume ? d : null);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 2500);
    return () => clearInterval(id);
  }, [gate, fetchSwipeSession, swipeActor]);

  useEffect(() => {
    if (!sessionWaitOnly || legacySwipeRef.current) return undefined;
    const id = window.setInterval(() => {
      void refreshSessionDeck();
    }, 2800);
    return () => clearInterval(id);
  }, [sessionWaitOnly, refreshSessionDeck]);

  useEffect(() => {
    if (gate !== null || legacySwipeRef.current || !swipeActor) return undefined;
    void refreshSessionDeck();
    return undefined;
  }, [swipeActor, gate, refreshSessionDeck]);

  const endSession = useCallback(async () => {
    legacySwipeRef.current = false;
    setSseDisabled(false);
    setLiveSessionPublicId("");
    setSessionWaitOnly(false);
    try {
      await fetch(appUrl("/api/swipe/session/end"), { method: "POST", credentials: "include" });
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
      const r = await fetchSwipeSession();
      const d = (await r.json()) as SessionPayload;
      if (!d.active) {
        toast({ title: "Não há mais sessão ativa", kind: "error" });
        setPendingSession(null);
        return;
      }
      const raw = (d.deck || []) as DeckCard[];
      const mine = filterDeckForProfile(raw, profileFromPayload(d));
      const waiting =
        Boolean(d.session_waiting) || (raw.length > 0 && mine.length === 0);
      if (mine.length > 0) {
        setSessionWaitOnly(false);
        setDeck(mine);
        setIdx(0);
        setGate(null);
        setPendingSession(null);
        setSseDisabled(false);
        setLiveSessionPublicId(String(d.session_public_id || "").trim());
        const dt = typeof d.deck_total === "number" ? d.deck_total : 0;
        setDeckTotalLive(dt);
        const ca = typeof d.cursor_index_a === "number" ? d.cursor_index_a : 0;
        const cb = typeof d.cursor_index_b === "number" ? d.cursor_index_b : 0;
        setLiveCursors({ a: ca, b: cb });
        return;
      }
      if (waiting) {
        setSessionWaitOnly(true);
        setDeck([]);
        setIdx(0);
        setGate(null);
        setPendingSession(null);
        setSseDisabled(false);
        setLiveSessionPublicId(String(d.session_public_id || "").trim());
        const dtW = typeof d.deck_total === "number" ? d.deck_total : 0;
        setDeckTotalLive(dtW);
        const caW = typeof d.cursor_index_a === "number" ? d.cursor_index_a : 0;
        const cbW = typeof d.cursor_index_b === "number" ? d.cursor_index_b : 0;
        setLiveCursors({ a: caW, b: cbW });
        return;
      }
      toast({ title: "Nada para mostrar neste perfil", kind: "info" });
    } catch {
      toast({ title: "Erro ao entrar na sessão", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast, fetchSwipeSession]);

  useEffect(() => {
    if (!swipeActor) return undefined;
    void refreshSessionMatches(false);
    const id = window.setInterval(() => {
      void refreshSessionMatches(true);
    }, 2800);
    return () => clearInterval(id);
  }, [swipeActor, refreshSessionMatches]);

  const streamSessionId =
    gate === null && !sseDisabled && liveSessionPublicId.trim() ? liveSessionPublicId.trim() : null;
  const { partnerOnline, lastEvent, connectionState, partnerSlug } = useSwipeStream(
    streamSessionId,
    swipeActor?.slug ?? "a",
    { onResync: () => scheduleDebouncedDeckResync(280) }
  );

  useEffect(() => {
    if (!lastEvent || !swipeActor) return undefined;
    if (lastEvent.type === "vote") {
      const sig = `v-${lastEvent.item_id}-${lastEvent.cursor_a}-${lastEvent.cursor_b}-${lastEvent.profile}`;
      if (lastVoteSigRef.current === sig) return undefined;
      lastVoteSigRef.current = sig;
      setLiveCursors({ a: lastEvent.cursor_a, b: lastEvent.cursor_b });
      // Só ressincronizamos o deck pelo SSE quando foi o PARCEIRO que votou.
      // Se foi o próprio usuário, o `act()` já atualizou tudo de forma otimista
      // e agendou um refresh sequencial — fazer outro aqui só gera corrida e
      // pode sobrescrever o deck otimista com um GET que ainda não enxerga o
      // commit mais recente (voltando o cartão pra fila).
      if (lastEvent.profile !== swipeActor.slug) {
        scheduleDebouncedDeckResync(350);
        setPartnerVoteFlash(true);
        const t = window.setTimeout(() => setPartnerVoteFlash(false), 620);
        return () => window.clearTimeout(t);
      }
    }
    if (lastEvent.type === "match") {
      const sig = `m-${lastEvent.tmdb_id}-${lastEvent.media_type || "movie"}`;
      if (lastMatchSigRef.current === sig) return undefined;
      lastMatchSigRef.current = sig;
      setMatchOverlay(lastEvent);
      void refreshSessionMatches(false);
    }
    return undefined;
  }, [lastEvent, swipeActor, refreshSessionMatches, scheduleDebouncedDeckResync]);

  useEffect(() => {
    if (prevPartnerOnlineRef.current === false && partnerOnline === true) {
      setPartnerPillEnter(true);
      const t = window.setTimeout(() => setPartnerPillEnter(false), 520);
      prevPartnerOnlineRef.current = partnerOnline;
      return () => window.clearTimeout(t);
    }
    prevPartnerOnlineRef.current = partnerOnline;
    return undefined;
  }, [partnerOnline]);

  useEffect(() => {
    if (!matchOverlay) return undefined;
    haptic([20, 36, 28]);
    const t = window.setTimeout(() => setMatchOverlay(null), 4800);
    return () => window.clearTimeout(t);
  }, [matchOverlay]);

  const current = deck[idx];
  const currentKey = current ? `${current.media_type}:${current.tmdb_id}` : "";
  const currentMeta = currentKey
    ? cardMetaMap[currentKey] ?? cardMetaCacheRef.current.get(currentKey)
    : undefined;
  const currentMetaLoading =
    !!currentKey && cardMetaFetch.key === currentKey && cardMetaFetch.status === "loading";
  const currentMetaError =
    !!currentKey && cardMetaFetch.key === currentKey && cardMetaFetch.status === "error";

  useEffect(() => {
    setCardMetaExpanded(false);
  }, [currentKey]);

  const ensureCardMeta = useCallback(async (card: DeckCard) => {
    const k = `${card.media_type}:${card.tmdb_id}`;
    if (cardMetaCacheRef.current.has(k)) {
      setCardMetaFetch((prev) =>
        prev.key === k && prev.status !== "idle" ? { key: k, status: "idle" } : prev,
      );
      return;
    }
    if (cardMetaInFlightRef.current.has(k)) {
      setCardMetaFetch({ key: k, status: "loading" });
      return;
    }
    cardMetaInFlightRef.current.add(k);
    setCardMetaFetch({ key: k, status: "loading" });
    const qs = new URLSearchParams({
      media_type: card.media_type,
      tmdb_id: String(card.tmdb_id),
    });
    try {
      const r = await fetch(appUrl(`/api/swipe/card-meta?${qs.toString()}`), {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await r.json()) as Partial<SwipeCardMeta>;
      const overview = typeof payload.overview === "string" ? payload.overview.trim() : "";
      const cast_top = Array.isArray(payload.cast_top)
        ? payload.cast_top.filter((n): n is string => typeof n === "string").slice(0, 3)
        : [];
      const entry: SwipeCardMeta = { overview, cast_top };
      cardMetaCacheRef.current.set(k, entry);
      setCardMetaMap((prev) => ({ ...prev, [k]: entry }));
      setCardMetaFetch((prev) => (prev.key === k ? { key: k, status: "idle" } : prev));
    } catch {
      setCardMetaFetch((prev) => (prev.key === k ? { key: k, status: "error" } : prev));
    } finally {
      cardMetaInFlightRef.current.delete(k);
    }
  }, []);

  const handleToggleCardMeta = useCallback(
    (card: DeckCard) => {
      setCardMetaExpanded((prev) => {
        const next = !prev;
        if (next) {
          void ensureCardMeta(card);
        }
        return next;
      });
    },
    [ensureCardMeta],
  );

  async function act(action: "like" | "reject", card: DeckCard) {
    if (actBusyRef.current) return;
    actBusyRef.current = true;
    haptic(action === "like" ? 12 : [6, 4, 6]);
    try {
      const res = await fetch(appUrl("/api/swipe/action"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdb_id: card.tmdb_id,
          media_type: card.media_type,
          action,
          title: card.title,
          poster_path: card.poster_path || "",
          profile: swipeActor?.slug ?? "a",
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        const errMsg = String((j as { error?: string }).error || "");
        const duplicado =
          errMsg.includes("já avaliou") ||
          errMsg.includes("já finalizado") ||
          errMsg.includes("cartão já");
        if (duplicado && !legacySwipeRef.current) {
          // Deck ficou dessincronizado (outra aba, parceiro votou sem chegar
          // o SSE, etc.). Remove o cartão localmente e pede o deck autoritativo.
          setDeck((prev) =>
            prev.filter(
              (c) => !(c.tmdb_id === card.tmdb_id && c.media_type === card.media_type)
            )
          );
          setIdx(0);
          await refreshSessionDeck();
          toast({
            title: "Cartas sincronizadas",
            description:
              "Este título já tinha sido contabilizado (por exemplo, o outro perfil ou outra aba). Atualizamos o deck.",
            kind: "info",
          });
          return;
        }
        toast({ title: errMsg || "Ação inválida", kind: "error" });
        return;
      }
      if (j.state === "matched") {
        haptic([20, 40, 30]);
        if (legacySwipeRef.current) {
          toast({ title: "Deu match! 💜", kind: "success" });
        } else {
          const sig = `m-${card.tmdb_id}-${card.media_type}`;
          if (lastMatchSigRef.current !== sig) {
            lastMatchSigRef.current = sig;
            setMatchOverlay({
              type: "match",
              item_id: 0,
              tmdb_id: card.tmdb_id,
              media_type: card.media_type,
              title: card.title,
              poster_path: card.poster_path,
            });
            void refreshSessionMatches(false);
          }
        }
      }
      if (legacySwipeRef.current) {
        setIdx((i) => i + 1);
      } else {
        const prof = swipeActor?.slug ?? "a";
        // Avanço imediato: o cartão que acabaste de resolver sai da fila local
        // antes do GET (evita ficar preso se a resposta vier em cache ou estados atrasados).
        setDeck((prev) =>
          filterDeckForProfile(
            prev.filter((c) => !(c.tmdb_id === card.tmdb_id && c.media_type === card.media_type)),
            prof
          )
        );
        setIdx(0);
        // Sequencial: o servidor já comitou; o GET logo abaixo devolve o deck
        // autoritativo sem o cartão votado. Se rolar evento SSE "vote" do
        // próprio usuário em paralelo, ele não agenda outro GET (ver useEffect
        // do lastEvent). Assim evitamos corrida entre GETs concorrentes.
        if (deckResyncTimerRef.current != null) {
          window.clearTimeout(deckResyncTimerRef.current);
          deckResyncTimerRef.current = null;
        }
        await refreshSessionDeck();
        await refreshSessionMatches(false);
      }
    } catch {
      toast({ title: "Erro ao registrar ação", kind: "error" });
    } finally {
      actBusyRef.current = false;
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

  if (!swipeActor) {
    return (
      <div className="swipe-root">
        <SurfacePanel className="swipe-session-gate" variant="plate" aura>
          <span className="swipe-eyebrow"><Users size={14} /> Swipe</span>
          <h2 className="swipe-gate-title">Carregando perfil…</h2>
          <p className="swipe-hero-sub">Sincronizando com a escolha de Bem-vindo (ou do menu no topo).</p>
          <div className="swipe-skeleton" style={{ minHeight: 120 }}>
            <Skeleton width="100%" height="100%" rounded="lg" />
          </div>
        </SurfacePanel>
      </div>
    );
  }

  if (gate === "pick") {
    const raw = (pendingSession?.deck || []) as DeckCard[];
    const myMine = filterDeckForProfile(raw, swipeActor.slug);
    const myQueue = myMine.length;
    const rawLen = raw.length;
    const total = pendingSession?.deck_total ?? 0;
    const sid = (pendingSession?.session_public_id || "").trim();
    const sidShort = sid.length >= 8 ? `${sid.slice(0, 8)}…` : sid;
    const waiting =
      Boolean(pendingSession?.session_waiting) || (rawLen > 0 && myQueue === 0);
    const canContinue = Boolean(pendingSession?.active && (myQueue > 0 || waiting));
    const sessionHint = !pendingSession?.active
      ? " Ainda não há sessão ativa: use “Iniciar nova sessão”."
      : waiting
        ? " Há uma sessão em andamento; neste perfil você está aguardando a resposta do outro nas cartas atuais — pode entrar na mesma sala."
        : myQueue > 0
          ? ` Há sessão ativa: ${myQueue} título(s) na sua fila${total ? ` (de ~${total} no deck)` : ""}.`
          : " Há sessão ativa, mas sem cartas visíveis para este perfil.";
    return (
      <div className="swipe-root">
        <ScrollReveal>
          <SurfacePanel className="swipe-session-gate" variant="plate" aura>
            <span className="swipe-eyebrow"><Users size={14} /> Sessão do swipe</span>
            <h2 className="swipe-gate-title">Sessão compartilhada</h2>
            {sid ? (
              <p className="swipe-hero-sub swipe-session-id-line">
                <strong>Sessão</strong> <code className="swipe-session-code">{sidShort}</code>
                {" — id único desta rodada (novo a cada “Iniciar nova sessão”)."}
              </p>
            ) : null}
            <p className="swipe-hero-sub">
              O mesmo deck para os <strong>dois perfis</strong> e em qualquer celular — assim os matches batem certo.
              {sessionHint}
            </p>
            <div className="swipe-gate-profile">
              <p className="swipe-gate-profile-hint">
                Neste aparelho você está como <strong>{swipeActor.label}</strong> (mesma escolha de{" "}
                <strong>Bem-vindo</strong> ou do menu no topo). Cada um avança no próprio ritmo no deck.
              </p>
            </div>
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
              Escolha uma <strong>lista</strong> (fila ou listas que vocês criaram em Listas) ou monte um deck{" "}
              <strong>por gênero TMDB</strong>.
            </p>
            <div className="swipe-new-kind-grid">
              <button type="button" className="swipe-new-kind-tile" onClick={() => setListSheetOpen(true)}>
                <span className="swipe-new-kind-icon" aria-hidden="true"><ListFilter size={28} /></span>
                <span className="swipe-new-kind-title">Escolher lista…</span>
                <span className="swipe-new-kind-desc">
                  Assistir depois ou qualquer lista custom — mesmo conteúdo da página Listas
                </span>
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
            <Sheet open={listSheetOpen} onOpenChange={setListSheetOpen} title="Lista como deck">
              <div className="swipe-list-sheet">
                <p className="swipe-hero-sub" style={{ marginTop: 0 }}>
                  Só entram títulos que ainda estão na lista. A fila “Assistir depois” é a mesma da página Listas.
                </p>
                <div className="swipe-list-sheet-actions">
                  <MagneticButton
                    variant="primary"
                    block
                    disabled={!listPickerData || listPickerData.builtin.item_count < 1}
                    onClick={() => {
                      setListSheetOpen(false);
                      void startSession({ source: "watchlater" });
                    }}
                  >
                    Assistir depois
                    {listPickerData ? ` (${listPickerData.builtin.item_count})` : ""}
                  </MagneticButton>
                  {(listPickerData?.custom || []).map((row) => (
                    <MagneticButton
                      key={row.id}
                      variant="glass"
                      block
                      disabled={row.item_count < 1}
                      onClick={() => {
                        setListSheetOpen(false);
                        void startSession({ source: "list", list_id: row.id });
                      }}
                    >
                      {row.name} ({row.item_count})
                    </MagneticButton>
                  ))}
                </div>
              </div>
            </Sheet>
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
            <span className="swipe-eyebrow"><Sparkles size={14} /> Por gênero</span>
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

  const meSlug = swipeActor.slug;
  const totalDeck = Math.max(1, deckTotalLive || 1);
  const pctMe = Math.min(100, (liveCursors[meSlug] / totalDeck) * 100);
  const pctPart = Math.min(100, (liveCursors[partnerSlug] / totalDeck) * 100);
  const meLab = profileLabels[meSlug] || meSlug.toUpperCase();
  const partLab = profileLabels[partnerSlug] || partnerSlug.toUpperCase();
  const partnerDotClass =
    connectionState === "reconnecting"
      ? "swipe-partner-dot is-reconnect"
      : partnerOnline
        ? "swipe-partner-dot is-live"
        : "swipe-partner-dot";

  return (
    <div className="swipe-root">
      {streamSessionId ? (
        <div className="swipe-live-top" aria-live="polite">
          <div className={cx("swipe-partner-pill", partnerPillEnter && "is-enter")}>
            <span className={partnerDotClass} title={partnerOnline ? "Online" : "Offline"} aria-hidden="true" />
            {connectionState === "reconnecting" ? (
              <Loader2 size={14} className="swipe-spin" style={{ opacity: 0.9 }} aria-hidden />
            ) : null}
            <div className="swipe-partner-text">
              <strong>{partLab}</strong>
              {partnerOnline ? " está aqui" : " está offline"}
              {!partnerOnline ? (
                <span className="swipe-partner-sub">Votos dela serão contados quando ela entrar.</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {partnerVoteFlash ? (
        <div className="swipe-partner-vote-flash" aria-hidden="true">
          <div
            className="swipe-partner-vote-orb"
            style={{
              background:
                partnerSlug === "b"
                  ? "radial-gradient(circle at 30% 30%, #fff, rgba(96, 165, 250, 0.95))"
                  : undefined,
              boxShadow:
                partnerSlug === "b" ? "0 0 24px rgba(96, 165, 250, 0.55)" : undefined,
            }}
          />
          <span className="swipe-partner-vote-hint">{`${partLab} votou ✓`}</span>
        </div>
      ) : null}

      <ScrollReveal>
        <section className="swipe-hero">
          <div className="swipe-hero-aura" aria-hidden="true" />
          <span className="swipe-eyebrow"><Users size={14} /> Modo casal</span>
          <h1 className="swipe-hero-title">
            <GradientTitle as="span" size="xl">O que vamos ver juntos?</GradientTitle>
          </h1>
          <p className="swipe-hero-sub">
            Deslize para curtir ou rejeitar. Quando os dois curtem o mesmo título, é match.
          </p>
          {streamSessionId ? (
            <div className="swipe-live-progress">
              <div className="swipe-live-progress-labels">
                <span>
                  <strong>{meLab}</strong>: {liveCursors[meSlug]} votos
                </span>
                <span>
                  <strong>{partLab}</strong>: {liveCursors[partnerSlug]} votos
                </span>
              </div>
              <div className="swipe-live-progress-bar swipe-live-progress-bar--split">
                <div className="swipe-live-cell">
                  <div className="swipe-live-progress-a" style={{ width: `${pctMe}%` }} />
                </div>
                <div className="swipe-live-cell">
                  <div className="swipe-live-progress-b" style={{ width: `${pctPart}%` }} />
                </div>
              </div>
              <div className="swipe-hero-stats" style={{ marginTop: 12 }}>
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
            </div>
          ) : (
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
          )}
        </section>
      </ScrollReveal>

      <SurfacePanel className="swipe-toolbar">
        <span className="swipe-toolbar-profile" title="Definido em Bem-vindo ou no topo">
          <Users size={14} aria-hidden /> {swipeActor.label}
        </span>
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
            title="Aguardando o outro perfil"
            description="Há cartas em andamento nesta sessão; o seu perfil já respondeu ou ainda não é a sua vez. Atualizamos automaticamente — ou abra “Sessão” e volte."
            action={
              <MagneticButton variant="primary" onClick={() => void refreshSessionDeck()}>
                <ListFilter size={16} /> Atualizar agora
              </MagneticButton>
            }
          />
        ) : atEnd ? (
          <EmptyState
            title="Fim do deck por agora"
            description="Abra “Sessão” para criar uma nova ou recarregue com a mesma origem."
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
                    : source === "list" && typeof lastListDeckRef.current.list_id === "number"
                      ? startSession({
                          source: "list",
                          list_id: lastListDeckRef.current.list_id,
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
                  meta={isTop ? currentMeta : undefined}
                  metaLoading={isTop && currentMetaLoading}
                  metaError={isTop && currentMetaError}
                  metaExpanded={isTop ? cardMetaExpanded : false}
                  onToggleMeta={() => handleToggleCardMeta(card)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {current && !atEnd && !loading && (
        <div className="swipe-actions-row">
          <MagneticButton variant="danger" onClick={() => act("reject", current)} aria-label="Rejeitar">
            <X size={18} /> Não
          </MagneticButton>
          <MagneticButton variant="success" onClick={() => act("like", current)} aria-label="Curtir">
            <Heart size={18} /> Curtir
          </MagneticButton>
        </div>
      )}

      <SurfacePanel className="swipe-session-matches" variant="plate" aura>
        <div className="swipe-session-matches-head">
          <span className="swipe-eyebrow"><Heart size={14} /> Matches da sessão</span>
          {sessionMatchesSid ? (
            <code className="swipe-session-code">{sessionMatchesSid.slice(0, 8)}…</code>
          ) : null}
        </div>
        {sessionMatches.length === 0 ? (
          <p className="swipe-session-matches-empty">
            Ainda não houve match nesta sessão. Quando Gabe e Princesinha curtirem o mesmo título, ele aparece aqui.
          </p>
        ) : (
          <div className="swipe-session-matches-grid">
            {sessionMatches.map((m) => (
              <article className="swipe-session-match-item" key={m.id}>
                {m.poster_path ? (
                  <img src={posterUrl(m.poster_path, "w185")} alt="" />
                ) : (
                  <div className="swipe-session-match-ph">🎬</div>
                )}
                <div>
                  <p className="swipe-session-match-title">{m.title}</p>
                  <p className="swipe-session-match-meta">{m.media_type === "tv" ? "Série" : "Filme"}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </SurfacePanel>

      <AnimatePresence>
        {matchOverlay ? (
          <motion.div
            key="swipe-match-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swipe-match-title"
            className="swipe-match-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMatchOverlay(null)}
          >
            <motion.div
              className="swipe-match-card"
              initial={{ scale: 0.88, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="swipe-match-kicker">Combinaram!</p>
              {matchOverlay.poster_path ? (
                <img src={posterUrl(matchOverlay.poster_path, "w342")} alt="" />
              ) : (
                <div className="swipe-session-match-ph" style={{ margin: "0 auto", maxWidth: 200 }}>
                  🎬
                </div>
              )}
              <h2 id="swipe-match-title" className="swipe-match-title">
                {matchOverlay.title}
              </h2>
              <MagneticButton variant="primary" className="swipe-match-cta" onClick={() => setMatchOverlay(null)}>
                Continuar
              </MagneticButton>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
  meta,
  metaLoading,
  metaError,
  metaExpanded,
  onToggleMeta,
}: {
  card: DeckCard;
  depth: number;
  isTop: boolean;
  reduce: boolean;
  onLike: () => void;
  onReject: () => void;
  meta?: SwipeCardMeta;
  metaLoading: boolean;
  metaError: boolean;
  metaExpanded: boolean;
  onToggleMeta: () => void;
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
        <button
          type="button"
          className={cx("swipe-card-meta-toggle", metaExpanded && "is-open")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMeta();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-expanded={metaExpanded}
        >
          {metaExpanded ? "Ocultar sinopse e elenco" : "Ver sinopse e elenco"}
        </button>
        {metaExpanded ? (
          <div className="swipe-card-meta-panel" onPointerDown={(e) => e.stopPropagation()}>
            {metaLoading && !meta ? (
              <p className="swipe-card-meta-loading">Carregando detalhes…</p>
            ) : metaError && !meta ? (
              <p className="swipe-card-meta-loading">Não foi possível carregar os detalhes.</p>
            ) : meta ? (
              <>
                {meta.overview ? (
                  <p className="swipe-card-overview">{meta.overview}</p>
                ) : null}
                {meta.cast_top.length ? (
                  <div className="swipe-card-cast">
                    <span className="swipe-card-cast-label">Elenco:</span>
                    <div className="swipe-card-cast-list">
                      {meta.cast_top.map((name) => (
                        <span key={name} className="swipe-card-cast-chip">
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!meta.overview && !meta.cast_top.length ? (
                  <p className="swipe-card-meta-loading">Sem detalhes extras deste título.</p>
                ) : null}
              </>
            ) : (
              <p className="swipe-card-meta-loading">Carregando detalhes…</p>
            )}
          </div>
        ) : null}
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

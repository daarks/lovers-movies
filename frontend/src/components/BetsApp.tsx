import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Dices, Trophy, Clock, Flag, Sparkles, Zap } from "lucide-react";
import { GradientTitle, NumberTicker, ScrollReveal, SurfacePanel, EmptyState, Skeleton, Chip } from "../ds";

interface BetCard {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path?: string | null;
  status_line: string;
  has_open: boolean;
}

interface ProfileInfo { label: string; slug: string }

interface BetsOverview {
  cards: BetCard[];
  victories: Record<"a" | "b", number>;
  profile_a: ProfileInfo;
  profile_b: ProfileInfo;
}

const FILTERS = [
  { id: "all", label: "Todas", icon: <Sparkles size={12} /> },
  { id: "open", label: "Em aberto", icon: <Clock size={12} /> },
  { id: "resolved", label: "Resolvidas", icon: <Trophy size={12} /> },
] as const;

type FilterId = typeof FILTERS[number]["id"];

function posterUrl(path: string | null | undefined, size = "w185") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export default function BetsApp() {
  const [data, setData] = useState<BetsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterId>("all");
  const reduce = useReducedMotion();

  useEffect(() => {
    fetch("/api/bets/overview")
      .then((r) => r.json())
      .then((d: BetsOverview) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const cards = useMemo(() => {
    if (!data) return [];
    if (filter === "open") return data.cards.filter((c) => c.has_open);
    if (filter === "resolved") return data.cards.filter((c) => !c.has_open);
    return data.cards;
  }, [data, filter]);

  const leader = useMemo(() => {
    if (!data) return null;
    const a = data.victories.a || 0;
    const b = data.victories.b || 0;
    if (a === b) return null;
    return a > b ? data.profile_a : data.profile_b;
  }, [data]);

  if (loading) {
    return (
      <div className="bets-root">
        <section className="bets-hero"><Skeleton width="60%" height={40} /><Skeleton width="40%" height={20} /></section>
        <div className="bets-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={240} />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bets-root">
        <EmptyState title="Sem dados de apostas" description="Verifique se a gamificação está ativa." />
      </div>
    );
  }

  return (
    <div className="bets-root">
      <ScrollReveal>
        <section className="bets-hero">
          <div className="bets-hero-aura" aria-hidden="true" />
          <span className="bets-eyebrow"><Dices size={14} /> Temporada de palpites</span>
          <h1 className="bets-hero-title">
            <GradientTitle as="span" size="xl" variant="gold">Apostas do casal</GradientTitle>
          </h1>
          <p className="bets-hero-sub">
            Palpites antes da sessão. Ao registrar a nota no histórico, a gente resolve quem chegou mais perto.
          </p>
          <div className="bets-scoreboard">
            <motion.div
              className={`bets-score bets-score--a ${leader?.slug === "a" ? "is-leader" : ""}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <span className="bets-score-label">{data.profile_a.label}</span>
              <span className="bets-score-value"><NumberTicker value={data.victories.a || 0} /></span>
              <span className="bets-score-unit">vitórias</span>
            </motion.div>
            <div className="bets-score-vs" aria-hidden="true">
              <Zap size={20} />
            </div>
            <motion.div
              className={`bets-score bets-score--b ${leader?.slug === "b" ? "is-leader" : ""}`}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <span className="bets-score-label">{data.profile_b.label}</span>
              <span className="bets-score-value"><NumberTicker value={data.victories.b || 0} /></span>
              <span className="bets-score-unit">vitórias</span>
            </motion.div>
          </div>
        </section>
      </ScrollReveal>

      <SurfacePanel className="bets-filterbar">
        <div className="bets-filters">
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              active={filter === f.id}
              onClick={() => setFilter(f.id)}
              variant="gold"
              icon={f.icon}
            >
              {f.label}
            </Chip>
          ))}
        </div>
        <span className="bets-count">{cards.length} título(s)</span>
      </SurfacePanel>

      {cards.length === 0 ? (
        <EmptyState
          title="Nenhuma aposta por aqui"
          description="Entre num título e toque em Apostar! para começar."
        />
      ) : (
        <div className="bets-grid">
          {cards.map((c, idx) => (
            <motion.a
              key={`${c.tmdb_id}-${c.media_type}`}
              className={`bets-card ${c.has_open ? "bets-card--open" : "bets-card--closed"}`}
              href={`/apostas/${c.media_type}/${c.tmdb_id}`}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.36, delay: idx * 0.04 }}
              whileHover={reduce ? undefined : { y: -4 }}
            >
              <div className="bets-card-media">
                {c.poster_path ? (
                  <img src={posterUrl(c.poster_path, "w342")} alt="" loading="lazy" />
                ) : (
                  <div className="bets-card-ph">🎬</div>
                )}
                <span className="bets-card-media-gradient" aria-hidden="true" />
              </div>
              <div className="bets-card-body">
                <span className="bets-card-chip">{c.media_type === "movie" ? "Filme" : "Série"}</span>
                <h3 className="bets-card-title" title={c.title}>{c.title}</h3>
                <p className={`bets-card-status ${c.has_open ? "is-open" : ""}`}>
                  {c.has_open ? <Flag size={12} /> : <Trophy size={12} />} {c.status_line}
                </p>
              </div>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
}

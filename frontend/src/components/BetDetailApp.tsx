import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Trophy, Target, Handshake, XCircle, CheckCircle2 } from "lucide-react";
import { GradientTitle, NumberTicker, ScrollReveal, SurfacePanel, EmptyState, Skeleton } from "../ds";

interface HeroInfo {
  title: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  media_type: "movie" | "tv";
  tmdb_id: number;
}

interface BetRow {
  profile_name: string;
  profile_slug: "a" | "b";
  predicted_rating: number;
  status: string;
  actual_rating?: number | null;
  diff?: number | null;
  exact_hit: boolean;
  outcome: "open" | "win" | "loss" | "draw";
}

interface DetailPayload {
  hero: HeroInfo;
  joint_rating: number | null;
  winner_name: string | null;
  winner_diff: number | null;
  winner_draw: boolean;
  bet_view_rows: BetRow[];
}

const OUTCOME_META: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  open: { label: "Aguardando resolução", icon: <Target size={16} />, className: "bets-duel--open" },
  win: { label: "Venceu o duelo", icon: <Trophy size={16} />, className: "bets-duel--win" },
  loss: { label: "Não foi o mais próximo", icon: <XCircle size={16} />, className: "bets-duel--loss" },
  draw: { label: "Empate técnico", icon: <Handshake size={16} />, className: "bets-duel--draw" },
};

function backdropUrl(path: string | null | undefined) {
  return path ? `https://image.tmdb.org/t/p/w1280${path}` : "";
}
function posterUrl(path: string | null | undefined) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : "";
}

function parseDetailId(): { mt: "movie" | "tv"; id: number } | null {
  const root = document.getElementById("bet-detail-root");
  if (!root) return null;
  const mt = root.dataset.mediaType as "movie" | "tv";
  const id = Number(root.dataset.tmdbId);
  if (!mt || !id) return null;
  return { mt, id };
}

export default function BetDetailApp() {
  const ctx = parseDetailId();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!ctx) return;
    fetch(`/api/bets/detail/${ctx.mt}/${ctx.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d: DetailPayload) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ctx?.id, ctx?.mt]);

  if (loading) {
    return (
      <div className="bet-detail-root">
        <Skeleton width="100%" height={280} />
        <Skeleton width="60%" height={32} />
        <Skeleton width="100%" height={220} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bet-detail-root">
        <EmptyState
          title="Aposta não encontrada"
          description="O título pode não ter palpites ativos."
          action={<a href="/apostas" className="rx-btn rx-btn--primary"><ArrowLeft size={14} /> Voltar para apostas</a>}
        />
      </div>
    );
  }

  const { hero, joint_rating, winner_name, winner_diff, winner_draw, bet_view_rows } = data;

  return (
    <div className="bet-detail-root">
      <a href="/apostas" className="bet-detail-back">
        <ArrowLeft size={16} /> Apostas
      </a>
      <ScrollReveal>
        <section className="bet-detail-hero">
          {hero.backdrop_path && (
            <div className="bet-detail-backdrop" aria-hidden="true" style={{ backgroundImage: `url(${backdropUrl(hero.backdrop_path)})` }} />
          )}
          <div className="bet-detail-hero-grad" aria-hidden="true" />
          <div className="bet-detail-hero-inner">
            <div className="bet-detail-poster">
              {hero.poster_path ? (
                <img src={posterUrl(hero.poster_path)} alt="" />
              ) : (
                <div className="bet-detail-poster-ph">🎬</div>
              )}
            </div>
            <div className="bet-detail-head">
              <span className="bet-detail-chip">{hero.media_type === "movie" ? "Filme" : "Série"}</span>
              <h1 className="bet-detail-title">
                <GradientTitle as="span" size="xl">{hero.title}</GradientTitle>
              </h1>
              {hero.overview && <p className="bet-detail-overview">{hero.overview}</p>}
              <div className="bet-detail-verdict">
                {joint_rating != null ? (
                  <>
                    <span className="bet-detail-verdict-label">Nota do casal</span>
                    <span className="bet-detail-verdict-value">
                      <NumberTicker value={joint_rating} decimals={1} />
                    </span>
                  </>
                ) : (
                  <span className="bet-detail-verdict-pending">Aguardando nota do casal</span>
                )}
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {(winner_name || winner_draw) && (
        <SurfacePanel className="bet-detail-champion">
          {winner_draw ? (
            <>
              <Handshake size={22} />
              <div>
                <strong>Empate técnico</strong>
                <p>Os dois chegaram à mesma distância da nota final.</p>
              </div>
            </>
          ) : winner_name ? (
            <>
              <Trophy size={22} />
              <div>
                <strong>{winner_name} venceu!</strong>
                {winner_diff != null && (
                  <p>Errou a nota por apenas <NumberTicker value={winner_diff} decimals={2} />.</p>
                )}
              </div>
            </>
          ) : null}
        </SurfacePanel>
      )}

      <SurfacePanel className="bet-detail-panel">
        <header className="bet-detail-panel-head">
          <span className="bet-detail-eyebrow">Duelo</span>
          <h2 className="bet-detail-panel-title">Palpite de cada perfil</h2>
        </header>
        <div className="bet-detail-duel-grid">
          {bet_view_rows.map((row, idx) => {
            const meta = OUTCOME_META[row.outcome] || OUTCOME_META.open;
            return (
              <motion.article
                key={`${row.profile_slug}-${idx}`}
                className={`bets-duel-card ${meta.className}`}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
              >
                <header className="bets-duel-head">
                  <span className={`bets-duel-avatar bets-duel-avatar--${row.profile_slug}`}>
                    {row.profile_name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{row.profile_name}</strong>
                    <span className="bets-duel-meta">
                      {meta.icon} {meta.label}
                    </span>
                  </div>
                </header>
                <div className="bets-duel-predict">
                  <span className="bets-duel-label">Palpite</span>
                  <span className="bets-duel-value">
                    <NumberTicker value={row.predicted_rating} decimals={1} />
                  </span>
                </div>
                {row.status === "resolved" && row.diff != null && (
                  <div className="bets-duel-diff">
                    {row.exact_hit ? (
                      <span className="bets-duel-diff-hit">
                        <CheckCircle2 size={14} /> Acertou em cheio!
                      </span>
                    ) : (
                      <>
                        <span className="bets-duel-label">Diferença</span>
                        <span className="bets-duel-value">
                          <NumberTicker value={row.diff} decimals={2} />
                        </span>
                      </>
                    )}
                  </div>
                )}
              </motion.article>
            );
          })}
        </div>
      </SurfacePanel>
    </div>
  );
}

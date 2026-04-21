import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform, useReducedMotion } from "framer-motion";
import { Sparkles, Trophy, Flame, CalendarDays, Gauge, Star, Compass } from "lucide-react";
import {
  GradientTitle,
  NumberTicker,
  ScrollReveal,
  SurfacePanel,
  EmptyState,
  Skeleton,
  Marquee,
  Chip,
} from "../ds";
import { appUrl } from "../lib/appBase";
import type {
  SeasonCurrentPayload,
  SeasonListBlock,
  SeasonalAchievement,
  SeasonCuratedItem,
} from "../lib/types";

function formatDateBR(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function posterUrl(path?: string | null, size = "w185") {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function rarityClass(rarity: string | undefined) {
  const r = (rarity || "").toLowerCase();
  if (r === "legendary") return "season-ach--legendary";
  if (r === "epic") return "season-ach--epic";
  if (r === "rare") return "season-ach--rare";
  if (r === "seasonal") return "season-ach--seasonal";
  return "season-ach--common";
}

export default function SeasonApp() {
  const [data, setData] = useState<SeasonCurrentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    fetch(appUrl("/api/season/current"))
      .then((r) => r.json())
      .then((d: SeasonCurrentPayload) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const { scrollY } = useScroll();
  const bgY = useTransform(scrollY, [0, 400], [0, reduce ? 0 : 120]);
  const emojiY = useTransform(scrollY, [0, 400], [0, reduce ? 0 : -80]);
  const emojiScale = useTransform(scrollY, [0, 400], [1, reduce ? 1 : 0.85]);

  const progressPct = Math.min(100, Math.max(0, Math.round(data?.progress_pct ?? 0)));
  const multPct = data?.xp_multiplier ? Math.round((data.xp_multiplier - 1) * 100) : 0;
  const bonusGenres = data?.bonus_genres ?? [];
  const achievements = data?.seasonal_achievements ?? [];
  const curated = data?.curated_lists ?? [];
  const keywordLists = data?.keyword_showcases ?? [];

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements],
  );
  const totalAch = achievements.length;

  if (loading) {
    return (
      <div className="season-root">
        <section className="season-hero">
          <Skeleton width="40%" height={24} />
          <Skeleton width="70%" height={56} />
          <Skeleton width="90%" height={20} />
          <Skeleton width="100%" height={14} rounded="full" />
        </section>
        <div className="season-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={160} />
          ))}
        </div>
      </div>
    );
  }

  if (!data || !data.enabled) {
    return (
      <div className="season-root">
        <EmptyState
          emoji="🏆"
          title="Temporadas desativadas"
          description="Ative a feature flag de temporadas para ver os eventos trimestrais, conquistas exclusivas e listas curadas."
        />
        <HowItWorks />
      </div>
    );
  }

  return (
    <div className="season-root">
      <section className="season-hero" data-theme={data.theme_key || "default"}>
        <motion.span
          className="season-hero-mesh"
          aria-hidden="true"
          style={{ y: bgY }}
        />
        <span className="season-hero-vignette" aria-hidden="true" />
        <motion.span
          className="season-hero-emoji"
          aria-hidden="true"
          style={{ y: emojiY, scale: emojiScale }}
        >
          {data.emoji || "🏆"}
        </motion.span>
        <motion.div
          className="season-hero-inner"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <span className="season-eyebrow">
            <Flame size={14} /> Temporada atual · {data.label}
          </span>
          <h1 className="season-hero-title">
            <GradientTitle as="span" size="display" variant="gold" shiny>
              {data.title || "Temporada"}
            </GradientTitle>
          </h1>
          {data.tagline ? <p className="season-hero-tagline">{data.tagline}</p> : null}
          {data.long_intro ? <p className="season-hero-intro">{data.long_intro}</p> : null}

          <div className="season-hero-chips">
            {multPct > 0 ? (
              <span className="season-chip season-chip--xp">
                <Sparkles size={12} /> +{multPct}% XP nos gêneros em alta
              </span>
            ) : null}
            {bonusGenres.slice(0, 8).map((g) => (
              <span key={String(g.id)} className="season-chip">
                {g.name}
              </span>
            ))}
          </div>

          <div className="season-hero-meta">
            <span>
              <CalendarDays size={14} /> {formatDateBR(data.starts_at)} → {formatDateBR(data.ends_at)}
            </span>
            <span>
              <Trophy size={14} /> {unlockedCount}/{totalAch} conquistas sazonais
            </span>
          </div>

          <div className="season-progress">
            <div
              className="season-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
            >
              <motion.span
                className="season-progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 1.2, ease: [0.22, 0.61, 0.36, 1] }}
              />
            </div>
            <span className="season-progress-label">
              <NumberTicker value={progressPct} />% concluída
            </span>
          </div>
        </motion.div>
      </section>

      {bonusGenres.length > 0 ? (
        <ScrollReveal>
          <section className="season-section">
            <header className="season-section-head">
              <h2 className="season-section-title">
                <Gauge size={18} /> Gêneros em alta
                <span className="season-section-hint">XP multiplicado durante o ciclo</span>
              </h2>
              <p className="season-section-desc">
                Títulos dos gêneros abaixo entregam XP extra automaticamente.
              </p>
            </header>
            <div className="season-genre-grid">
              {bonusGenres.map((g, idx) => (
                <motion.div
                  key={String(g.id)}
                  className="season-genre-card"
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.36, delay: idx * 0.05 }}
                  whileHover={reduce ? undefined : { y: -3 }}
                >
                  <span className="season-genre-aura" aria-hidden="true" />
                  <span className="season-genre-name">{g.name}</span>
                  {multPct > 0 ? (
                    <span className="season-genre-bonus">+{multPct}% XP</span>
                  ) : null}
                </motion.div>
              ))}
            </div>
          </section>
        </ScrollReveal>
      ) : null}

      {achievements.length > 0 ? (
        <ScrollReveal delay={0.05}>
          <section className="season-section">
            <header className="season-section-head">
              <h2 className="season-section-title">
                <Trophy size={18} /> Conquistas exclusivas
                <span className="season-section-hint">Só durante este ciclo</span>
              </h2>
              <p className="season-section-desc">
                Elas desaparecem do catálogo ativo quando a temporada terminar, mas permanecem no histórico.
              </p>
            </header>
            <div className="season-ach-grid">
              {achievements.map((ach, idx) => (
                <AchievementCard key={ach.id} ach={ach} index={idx} />
              ))}
            </div>
          </section>
        </ScrollReveal>
      ) : null}

      {curated.length > 0 ? (
        <ScrollReveal delay={0.1}>
          <section className="season-section">
            <header className="season-section-head">
              <h2 className="season-section-title">
                <Star size={18} /> Listas curadas
                <span className="season-section-hint">Prontas para maratonar</span>
              </h2>
              <p className="season-section-desc">
                Algumas dessas listas contam diretamente para conquistas sazonais.
              </p>
            </header>
            {curated.map((block) => (
              <PosterSlider key={block.id || block.title} block={block} />
            ))}
          </section>
        </ScrollReveal>
      ) : null}

      {keywordLists.length > 0 ? (
        <ScrollReveal delay={0.15}>
          <section className="season-section">
            <header className="season-section-head">
              <h2 className="season-section-title">
                <Compass size={18} /> Em destaque no TMDB
                <span className="season-section-hint">Curadoria automática</span>
              </h2>
              <p className="season-section-desc">
                Filmes populares ligados às keywords temáticas da temporada.
              </p>
            </header>
            {keywordLists.map((block) => (
              <PosterSlider key={block.keyword_id || block.title} block={block} marquee />
            ))}
          </section>
        </ScrollReveal>
      ) : null}

      <HowItWorks />
    </div>
  );
}

function AchievementCard({ ach, index }: { ach: SeasonalAchievement; index: number }) {
  const reduce = useReducedMotion();
  const pct = ach.target > 0 ? Math.min(100, Math.round((100 * ach.progress) / ach.target)) : 0;
  return (
    <motion.article
      className={`season-ach ${rarityClass(ach.rarity)} ${ach.unlocked ? "is-unlocked" : ""}`}
      initial={reduce ? false : { opacity: 0, y: 18, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: index * 0.05 }}
      whileHover={reduce ? undefined : { y: -3 }}
    >
      <span className="season-ach-aura" aria-hidden="true" />
      <div className="season-ach-head">
        <span className="season-ach-icon" aria-hidden="true">{ach.icon || "🏅"}</span>
        <div className="season-ach-head-text">
          <h3 className="season-ach-title">{ach.title}</h3>
          <p className="season-ach-desc">{ach.description}</p>
        </div>
        {ach.unlocked ? <span className="season-ach-badge">Desbloqueada</span> : null}
      </div>
      <div className="season-ach-bar">
        <motion.span
          className="season-ach-fill"
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </div>
      <div className="season-ach-meta">
        <span className="season-ach-progress">
          <NumberTicker value={ach.progress} /> / {ach.target}
        </span>
        <span className="season-ach-xp">
          <Sparkles size={12} /> +{ach.xp_reward} XP
        </span>
      </div>
    </motion.article>
  );
}

function PosterCard({ item }: { item: SeasonCuratedItem }) {
  const hover = useMotionValue(0);
  const ty = useSpring(useTransform(hover, [0, 1], [0, -6]), { stiffness: 260, damping: 20 });
  return (
    <motion.a
      className="season-poster-card"
      href={`/details/${item.media_type}/${item.tmdb_id}`}
      style={{ y: ty }}
      onHoverStart={() => hover.set(1)}
      onHoverEnd={() => hover.set(0)}
      onFocus={() => hover.set(1)}
      onBlur={() => hover.set(0)}
    >
      <div className="season-poster-frame">
        {item.poster_path ? (
          <img src={posterUrl(item.poster_path, "w342")} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="season-poster-ph" aria-hidden="true">🎬</span>
        )}
        {typeof item.vote_average === "number" && item.vote_average > 0 ? (
          <span className="season-poster-score">
            <Star size={10} fill="currentColor" /> {item.vote_average.toFixed(1)}
          </span>
        ) : null}
      </div>
      <span className="season-poster-title" title={item.title}>{item.title}</span>
      {item.year ? <span className="season-poster-meta">{item.year}</span> : null}
    </motion.a>
  );
}

function PosterSlider({ block, marquee = false }: { block: SeasonListBlock; marquee?: boolean }) {
  if (!block.items || block.items.length === 0) {
    return (
      <div className="season-list-block">
        <h3 className="season-list-title">{block.title}</h3>
        <p className="season-list-empty">Sem sugestões disponíveis agora.</p>
      </div>
    );
  }
  return (
    <div className="season-list-block">
      <h3 className="season-list-title">{block.title}</h3>
      {block.subtitle ? <p className="season-list-subtitle">{block.subtitle}</p> : null}
      {marquee ? (
        <Marquee className="season-marquee">
          <div className="season-poster-slider-track">
            {block.items.map((it) => (
              <PosterCard key={`${block.title}-${it.tmdb_id}-${it.media_type}`} item={it} />
            ))}
          </div>
        </Marquee>
      ) : (
        <div className="season-poster-slider">
          <div className="season-poster-slider-track">
            {block.items.map((it) => (
              <PosterCard key={`${block.title}-${it.tmdb_id}-${it.media_type}`} item={it} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <ScrollReveal delay={0.2}>
      <section className="season-section season-howto">
        <header className="season-section-head">
          <h2 className="season-section-title">
            <Gauge size={18} /> Como funciona o sistema de temporadas
          </h2>
          <p className="season-section-desc">
            Cada temporada dura um trimestre (3 meses) e tem um tema central. O app cria os ciclos no formato
            {" "}<code>AAAA-Q1</code>, <code>AAAA-Q2</code>, <code>AAAA-Q3</code>, <code>AAAA-Q4</code> automaticamente.
          </p>
        </header>
        <div className="season-howto-grid">
          <SurfacePanel className="season-howto-card" aura>
            <span className="season-howto-icon" aria-hidden="true">⚡</span>
            <h3>Gêneros bônus</h3>
            <p>
              Assistir algo dos gêneros em alta aplica um multiplicador de XP. O bônus aparece no seu ledger como
              "Bônus de temporada".
            </p>
          </SurfacePanel>
          <SurfacePanel className="season-howto-card" aura>
            <span className="season-howto-icon" aria-hidden="true">🏆</span>
            <h3>Conquistas sazonais</h3>
            <p>
              Existem só durante o ciclo atual, geralmente ligadas a listas curadas (clássicos do terror, Oscars
              recentes…) ou keywords específicas (Stephen King, Natal…).
            </p>
          </SurfacePanel>
          <SurfacePanel className="season-howto-card" aura>
            <span className="season-howto-icon" aria-hidden="true">💞</span>
            <h3>Placar do casal</h3>
            <p>
              Cada título assistido contribui para o placar da temporada em ambos os perfis (A e B), exibido no Perfil.
            </p>
          </SurfacePanel>
        </div>
        <div className="season-howto-actions">
          <Chip variant="accent" onClick={() => { window.location.href = "/perfil"; }}>
            Ver meu placar no perfil
          </Chip>
        </div>
      </section>
    </ScrollReveal>
  );
}
